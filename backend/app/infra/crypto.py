from pathlib import Path

from cryptography.fernet import Fernet


class SecretBox:
    """Encrypts SNMP secrets at rest with a Fernet key stored beside the database."""

    def __init__(self, key_path: Path):
        key_path = Path(key_path)
        if key_path.exists():
            key = key_path.read_bytes()
        else:
            key_path.parent.mkdir(parents=True, exist_ok=True)
            key = Fernet.generate_key()
            key_path.write_bytes(key)
            try:
                key_path.chmod(0o600)
            except OSError:
                pass
        self._fernet = Fernet(key)

    def encrypt(self, value: str | None) -> str | None:
        if value is None:
            return None
        return self._fernet.encrypt(value.encode()).decode()

    def decrypt(self, token: str | None) -> str | None:
        if token is None:
            return None
        return self._fernet.decrypt(token.encode()).decode()
