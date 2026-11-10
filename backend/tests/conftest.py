import pytest

from app.infra.crypto import SecretBox
from app.infra.db import make_session_factory


@pytest.fixture
def tmp_data_dir(tmp_path):
    d = tmp_path / "data"
    d.mkdir()
    return d


@pytest.fixture
def session_factory(tmp_data_dir):
    return make_session_factory(tmp_data_dir / "netpulse.db")


@pytest.fixture
def secret_box(tmp_data_dir):
    return SecretBox(tmp_data_dir / "secret.key")
