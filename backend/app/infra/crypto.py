import hashlib
import logging
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

log = logging.getLogger(__name__)


class SecretBox:
    """Encrypts SNMP and HTTP secrets at rest with a Fernet key stored beside the database."""

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
        self._warned: set[str] = set()  # digests of undecryptable tokens already reported

    def encrypt(self, value: str | None) -> str | None:
        if value is None:
            return None
        return self._fernet.encrypt(value.encode()).decode()

    def decrypt(self, token: str | None) -> str | None:
        """Returns None for a secret the current key cannot read (key file lost or replaced)."""
        if token is None:
            return None
        try:
            return self._fernet.decrypt(token.encode()).decode()
        except InvalidToken:
            digest = hashlib.sha256(token.encode()).hexdigest()
            if digest not in self._warned:
                self._warned.add(digest)
                log.warning("stored secret could not be decrypted; re-enter it")
            return None
