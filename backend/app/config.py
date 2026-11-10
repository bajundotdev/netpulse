import os
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


@dataclass
class Settings:
    host: str = "127.0.0.1"
    port: int = 8765
    data_dir: Path = field(default_factory=lambda: REPO_ROOT / "data")
    # Extra Host names accepted when bound beyond loopback (NETPULSE_ALLOWED_HOSTS, comma list).
    allowed_hosts: tuple[str, ...] = ()

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
        )

    @property
    def db_path(self) -> Path:
        return self.data_dir / "netpulse.db"

    @property
    def key_path(self) -> Path:
        return self.data_dir / "secret.key"
