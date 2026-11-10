from app.infra.crypto import SecretBox


def test_secret_box_round_trip_and_key_reused(tmp_path):
    box = SecretBox(tmp_path / "secret.key")
    token = box.encrypt("public")
    assert token != "public" and SecretBox(tmp_path / "secret.key").decrypt(token) == "public"
    assert box.encrypt(None) is None
    assert box.decrypt(None) is None
