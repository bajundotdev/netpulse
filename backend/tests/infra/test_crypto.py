from app.infra.crypto import SecretBox


def test_secret_box_round_trip_and_key_reused(tmp_path):
    box = SecretBox(tmp_path / "secret.key")
    token = box.encrypt("public")
    assert token != "public" and SecretBox(tmp_path / "secret.key").decrypt(token) == "public"
    assert box.encrypt(None) is None
    assert box.decrypt(None) is None


def test_decrypt_with_replaced_key_returns_none_and_logs_without_token(tmp_path, caplog):
    token = SecretBox(tmp_path / "secret.key").encrypt("public")
    (tmp_path / "secret.key").unlink()
    box = SecretBox(tmp_path / "secret.key")  # a lost key file is replaced by a fresh key
    with caplog.at_level("WARNING"):
        assert box.decrypt(token) is None
        assert box.decrypt(token) is None
    warnings = [r for r in caplog.records if r.levelname == "WARNING"]
    assert len(warnings) == 1
    assert "re-enter" in warnings[0].getMessage() and token not in caplog.text
