"""DNS-rebinding and cross-site write protection for the local API."""

import ipaddress

from starlette.datastructures import Headers
from starlette.responses import PlainTextResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from app.config import Settings

LOOPBACK_HOSTS = ("localhost", "127.0.0.1", "[::1]")
_MUTATING = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def _is_loopback(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host.strip("[]")).is_loopback
    except ValueError:
        return False


def _bracket(host: str) -> str:
    return f"[{host}]" if ":" in host and not host.startswith("[") else host


def allowed_hosts(settings: Settings) -> list[str]:
    """Host header values the server answers to: loopback, plus the bind host and
    NETPULSE_ALLOWED_HOSTS when the server is bound beyond loopback."""
    hosts = list(LOOPBACK_HOSTS)
    if not _is_loopback(settings.host):
        hosts += [_bracket(settings.host), *settings.allowed_hosts]
    return list(dict.fromkeys(h.lower() for h in hosts))


def allowed_origins(hosts: list[str], port: int) -> frozenset[str]:
    origins = {f"http://{h}:{port}" for h in hosts}
    if port == 80:
        origins |= {f"http://{h}" for h in hosts}
    return frozenset(origins)


class OriginGuard:
    """Rejects writes (403) whose Origin header names a site other than this server."""

    def __init__(self, app: ASGIApp, origins: frozenset[str]) -> None:
        self.app = app
        self.origins = origins

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["method"] in _MUTATING:
            origin = Headers(scope=scope).get("origin")
            if origin is not None and origin.lower() not in self.origins:
                await PlainTextResponse("Cross-origin request refused", status_code=403)(
                    scope, receive, send
                )
                return
        await self.app(scope, receive, send)
