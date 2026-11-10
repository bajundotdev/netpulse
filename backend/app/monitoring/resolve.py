import asyncio
import ipaddress
import socket


class ResolveError(Exception):
    pass


async def resolve_host(host: str) -> str:
    try:
        ipaddress.ip_address(host)
        return host
    except ValueError:
        pass
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, None, family=socket.AF_INET)
    except socket.gaierror as e:
        raise ResolveError(f"cannot resolve {host}: {e}") from e
    return infos[0][4][0]
