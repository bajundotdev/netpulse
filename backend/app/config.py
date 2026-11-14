import os
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
_TRUE = frozenset({"1", "true", "yes", "on"})


@dataclass
class Settings:
    host: str = "127.0.0.1"
    port: int = 8765
    data_dir: Path = field(default_factory=lambda: REPO_ROOT / "data")
    # Extra Host names accepted when bound beyond loopback (NETPULSE_ALLOWED_HOSTS, comma list).
    allowed_hosts: tuple[str, ...] = ()
    # Development aid (NETPULSE_DEBUG=1): API docs at /docs, tracebacks in error responses,
    # debug logging and the request log. Off by default and always off when run.bat starts it.
    debug: bool = False

    @classmethod
    def from_env(cls) -> "Settings":
        defaults = cls()
        return cls(
            host=os.environ.get("NETPULSE_HOST", defaults.host),
            port=int(os.environ.get("NETPULSE_PORT", defaults.port)),
            data_dir=Path(os.environ.get("NETPULSE_DATA_DIR", defaults.data_dir)),
            allowed_hosts=tuple(
                h.strip()
                for h in os.environ.get("NETPULSE_ALLOWED_HOSTS", "").split(",")
                if h.strip()
            ),
            debug=os.environ.get("NETPULSE_DEBUG", "").strip().lower() in _TRUE,
        )

    @property
    def db_path(self) -> Path:
        return self.data_dir / "netpulse.db"

    @property
    def key_path(self) -> Path:
        return self.data_dir / "secret.key"
