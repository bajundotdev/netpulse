import asyncio
import ssl
import time
from collections.abc import Callable
from datetime import datetime

from cryptography import x509


class CertReader:
    """Reads a server certificate's expiry with a separate, read-only TLS handshake.

    The context does not verify anything: the point is to learn the expiry even for an expired
    or untrusted certificate. Nothing is sent after the handshake. Successful reads are cached
    per host:port for ``ttl_s``; failures are not cached.
    """

    def __init__(self, ttl_s: float = 3600, clock: Callable[[], float] = time.monotonic) -> None:
        self._ttl = ttl_s
        self._clock = clock
        self._cache: dict[tuple[str, int], tuple[float, datetime]] = {}

    async def expiry(self, host: str, port: int, timeout_ms: int) -> datetime | None:
        key = (host, port)
        hit = self._cache.get(key)
        if hit is not None and self._clock() - hit[0] < self._ttl:
            return hit[1]
        try:
            expires = await asyncio.wait_for(self._handshake(host, port), timeout_ms / 1000)
        except (OSError, ssl.SSLError, ValueError, TimeoutError):
            return None
        if expires is not None:
            self._cache[key] = (self._clock(), expires)
        return expires

    @staticmethod
    async def _handshake(host: str, port: int) -> datetime | None:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        _, writer = await asyncio.open_connection(host, port, ssl=ctx, server_hostname=host)
        try:
            ssl_object = writer.get_extra_info("ssl_object")
            der = ssl_object.getpeercert(binary_form=True) if ssl_object is not None else None
            if not der:
                return None
            return x509.load_der_x509_certificate(der).not_valid_after_utc
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except (OSError, ssl.SSLError):
                pass
