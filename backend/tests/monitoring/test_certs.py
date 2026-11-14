import asyncio
import ssl
from datetime import UTC, datetime, timedelta

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

from app.monitoring.certs import CertReader


def make_cert(tmp_path, days: float):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")])
    now = datetime.now(UTC)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=days))
        .sign(key, hashes.SHA256())
    )
    cert_path, key_path = tmp_path / "cert.pem", tmp_path / "key.pem"
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        )
    )
    return cert_path, key_path, now + timedelta(days=days)


@pytest.fixture
async def tls_server(tmp_path):
    cert_path, key_path, expected = make_cert(tmp_path, 10)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(cert_path, key_path)
    connections: list[int] = []

    async def handle(reader, writer):
        connections.append(1)
        writer.close()

    server = await asyncio.start_server(handle, "127.0.0.1", 0, ssl=ctx)
    port = server.sockets[0].getsockname()[1]
    yield port, expected, connections
    server.close()
    await server.wait_closed()


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


async def test_reads_expiry_of_self_signed_cert(tls_server):
    port, expected, _ = tls_server
    got = await CertReader().expiry("127.0.0.1", port, 3000)
    assert got is not None and got.tzinfo is not None
    assert abs((got - expected).total_seconds()) < 5
    assert 9 <= (got - datetime.now(UTC)).days <= 10


async def test_second_read_within_ttl_is_cached(tls_server):
    port, _, connections = tls_server
    clock = Clock()
    reader = CertReader(ttl_s=3600, clock=clock)
    first = await reader.expiry("127.0.0.1", port, 3000)
    clock.t += 3599
    assert await reader.expiry("127.0.0.1", port, 3000) == first
    await asyncio.sleep(0.05)
    assert len(connections) == 1
    clock.t += 2  # past the TTL
    await reader.expiry("127.0.0.1", port, 3000)
    await asyncio.sleep(0.05)
    assert len(connections) == 2


async def test_unreachable_host_is_none_and_not_cached(tls_server):
    # a port nothing listens on
    srv = await asyncio.start_server(lambda r, w: None, "127.0.0.1", 0)
    port = srv.sockets[0].getsockname()[1]
    srv.close()
    await srv.wait_closed()
    reader = CertReader()
    assert await reader.expiry("127.0.0.1", port, 1000) is None


async def test_silent_server_times_out_within_budget():
    async def handle(reader, writer):
        try:
            await asyncio.sleep(5)
        finally:
            writer.close()

    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    loop = asyncio.get_running_loop()
    started = loop.time()
    assert await CertReader().expiry("127.0.0.1", port, 300) is None
    assert loop.time() - started < 2
    server.close()
    await server.wait_closed()
