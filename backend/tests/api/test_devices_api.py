import time

from app.infra.db import DeviceRow

SW = {"name": "SW1", "host": "10.0.0.2", "kind": "switch"}


def make(client, **kw):
    r = client.post("/api/devices", json={**SW, **kw})
    assert r.status_code == 201, r.text
    return r.json()


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_create_list_get_update_delete_device(client):
    d = make(client)
    assert d["name"] == "SW1" and d["interval_s"] == 5 and d["enabled"] is True
    assert d["checks"] == [] and d["snmp"] is None
    assert [x["id"] for x in client.get("/api/devices").json()] == [d["id"]]
    assert client.get(f"/api/devices/{d['id']}").json()["host"] == "10.0.0.2"

    r = client.put(f"/api/devices/{d['id']}", json={"host": "10.0.0.9", "enabled": False})
    assert r.status_code == 200
    assert r.json()["host"] == "10.0.0.9" and r.json()["enabled"] is False
    assert r.json()["name"] == "SW1"

    assert client.delete(f"/api/devices/{d['id']}").status_code == 204
    assert client.get("/api/devices").json() == []
    assert client.get(f"/api/devices/{d['id']}").status_code == 404


def test_duplicate_name_is_409(client):
    make(client)
    assert client.post("/api/devices", json=SW).status_code == 409
    other = make(client, name="SW2")
    assert client.put(f"/api/devices/{other['id']}", json={"name": "SW1"}).status_code == 409


def test_unknown_device_is_404(client):
    assert client.get("/api/devices/99").status_code == 404
    assert client.put("/api/devices/99", json={"host": "10.0.0.1"}).status_code == 404
    assert client.delete("/api/devices/99").status_code == 404
    assert client.post("/api/devices/99/test").status_code == 404
    assert client.get("/api/devices/99/checks").status_code == 404
    assert client.post("/api/devices/99/checks", json={"type": "tcp", "params": {"port": 80}}).status_code == 404
    assert client.put("/api/checks/99", json={"type": "tcp", "params": {"port": 80}}).status_code == 404
    assert client.delete("/api/checks/99").status_code == 404


def test_validation_is_422(client):
    for host in ("bad host", "192.168.1", "10.1", "10.0.0.256", "dc01.123"):
        assert client.post("/api/devices", json={"name": "x", "host": host}).status_code == 422
    d = make(client)
    assert client.put(f"/api/devices/{d['id']}", json={"interval_s": 1}).status_code == 422
    # timing is checked against the stored values: 4 s timeout fits the 5 s interval, a 3 s interval does not
    assert client.put(f"/api/devices/{d['id']}", json={"timeout_ms": 4000}).status_code == 200
    assert client.put(f"/api/devices/{d['id']}", json={"interval_s": 3}).status_code == 422
    r = client.put(f"/api/devices/{d['id']}", json={"liveness": "tcp"})
    assert r.status_code == 422


def test_secrets_never_returned(client):
    r = client.post(
        "/api/devices",
        json={**SW, "snmp": {"version": "v2c", "community": "public"}},
    )
    body = r.json()
    assert body["snmp"]["has_community"] is True and "public" not in r.text
    assert body["snmp"]["has_auth_key"] is False
    assert "community" not in body["snmp"] and "auth_key" not in body["snmp"]
    assert "public" not in client.get("/api/devices").text
    assert "public" not in client.get(f"/api/devices/{body['id']}").text


def test_secret_is_encrypted_at_rest_and_kept_on_update(client):
    d = client.post(
        "/api/devices", json={**SW, "snmp": {"version": "v2c", "community": "s3cr3t"}}
    ).json()
    sf = client.app.state.container.session_factory
    with sf() as s:
        assert s.get(DeviceRow, d["id"]).snmp_community_enc not in (None, "s3cr3t")
    # resending snmp without a community keeps the stored one
    r = client.put(f"/api/devices/{d['id']}", json={"snmp": {"version": "v2c", "port": 1161}})
    assert r.json()["snmp"]["port"] == 1161 and r.json()["snmp"]["has_community"] is True
    # empty string clears it, which would leave v2c unusable: rejected, stored one kept
    r = client.put(f"/api/devices/{d['id']}", json={"snmp": {"version": "v2c", "community": ""}})
    assert r.status_code == 422
    assert client.get(f"/api/devices/{d['id']}").json()["snmp"]["has_community"] is True


def test_update_snmp_null_removes_snmp_and_omitted_keeps_it(client):
    d = client.post(
        "/api/devices", json={**SW, "snmp": {"version": "v2c", "community": "public"}}
    ).json()
    kept = client.put(f"/api/devices/{d['id']}", json={"notes": "x"}).json()
    assert kept["snmp"]["has_community"] is True and kept["notes"] == "x"
    gone = client.put(f"/api/devices/{d['id']}", json={"snmp": None}).json()
    assert gone["snmp"] is None


def test_edit_to_unusable_snmp_is_422(client):
    d = make(client)
    # off -> v2c without a community
    r = client.put(f"/api/devices/{d['id']}", json={"snmp": {"version": "v2c"}})
    assert r.status_code == 422 and isinstance(r.json()["detail"], str)
    # v2c -> v3 with auth/priv protocols but no keys
    v2 = make(client, name="SW2", snmp={"version": "v2c", "community": "public"})
    r = client.put(f"/api/devices/{v2['id']}", json={"snmp": {
        "version": "v3", "user": "admin", "auth_proto": "SHA", "priv_proto": "AES128"}})
    assert r.status_code == 422 and isinstance(r.json()["detail"], str)
    # v3 auth only -> add privacy without a priv key
    v3 = make(client, name="SW3", snmp={"version": "v3", "user": "admin",
                                        "auth_proto": "SHA", "auth_key": "authsecret1"})
    r = client.put(f"/api/devices/{v3['id']}", json={"snmp": {
        "version": "v3", "user": "admin", "auth_proto": "SHA", "priv_proto": "AES128"}})
    assert r.status_code == 422
    # keys stored earlier still count
    r = client.put(f"/api/devices/{v3['id']}", json={"snmp": {
        "version": "v3", "user": "admin", "auth_proto": "SHA", "port": 1161}})
    assert r.status_code == 200 and r.json()["snmp"]["has_auth_key"] is True


def test_v2c_edit_of_port_keeps_stored_community(client):
    d = make(client, snmp={"version": "v2c", "community": "public"})
    r = client.put(f"/api/devices/{d['id']}", json={"snmp": {"version": "v2c", "port": 1161}})
    assert r.status_code == 200 and r.json()["snmp"]["has_community"] is True


def test_removing_snmp_with_snmp_checks_is_422(client):
    d = client.post(
        "/api/devices",
        json={**SW, "snmp": {"version": "v2c", "community": "public"},
              "checks": [{"type": "snmp_uptime"}]},
    ).json()
    assert client.put(f"/api/devices/{d['id']}", json={"snmp": None}).status_code == 422


def test_create_with_inline_checks_and_add_check(client):
    d = make(client, checks=[{"type": "tcp", "params": {"port": 389}}])
    assert [(c["type"], c["params"]) for c in d["checks"]] == [("tcp", {"port": 389})]
    r = client.post(f"/api/devices/{d['id']}/checks", json={"type": "tcp", "params": {"port": 88}})
    assert r.status_code == 201 and r.json()["device_id"] == d["id"]
    listed = client.get(f"/api/devices/{d['id']}/checks").json()
    assert [c["params"]["port"] for c in listed] == [389, 88]

    cid = r.json()["id"]
    up = client.put(f"/api/checks/{cid}", json={"type": "tcp", "params": {"port": 636}, "enabled": False})
    assert up.status_code == 200 and up.json()["params"] == {"port": 636} and up.json()["enabled"] is False
    assert client.delete(f"/api/checks/{cid}").status_code == 204
    assert len(client.get(f"/api/devices/{d['id']}").json()["checks"]) == 1


def test_bad_check_params_is_422(client):
    d = make(client)
    assert client.post(f"/api/devices/{d['id']}/checks", json={"type": "tcp", "params": {}}).status_code == 422
    assert client.post(f"/api/devices/{d['id']}/checks", json={"type": "bogus"}).status_code == 422


def test_snmp_check_without_snmp_settings_is_422(client):
    d = make(client)
    r = client.post(f"/api/devices/{d['id']}/checks", json={"type": "snmp_uptime"})
    assert r.status_code == 422
    r = client.post("/api/devices", json={"name": "X", "host": "10.0.0.3",
                                          "checks": [{"type": "snmp_uptime"}]})
    assert r.status_code == 422
    tcp = client.post(f"/api/devices/{d['id']}/checks", json={"type": "tcp", "params": {"port": 80}}).json()
    assert client.put(f"/api/checks/{tcp['id']}", json={"type": "snmp_uptime"}).status_code == 422


def test_test_endpoint_returns_results(client):
    d = make(client, checks=[{"type": "tcp", "params": {"port": 389}}])
    r = client.post(f"/api/devices/{d['id']}/test")
    assert r.status_code == 200
    results = r.json()
    assert [(x["type"], x["label"], x["ok"]) for x in results] == [
        ("ping", "ping", True),
        ("tcp", "tcp/389", True),
    ]
    assert results[0]["latency_ms"] == 1.5
    # does not change state
    st = [s for s in client.get("/api/status").json() if s["device_id"] == d["id"]][0]
    assert st["results"] == [] or st["status"] in ("UNKNOWN", "UP")


def test_status_snapshot_lists_every_device(client):
    a = make(client)
    b = make(client, name="SW2", enabled=False)
    c = make(client, name="SW3")
    rows = {s["device_id"]: s for s in client.get("/api/status").json()}
    assert set(rows) == {a["id"], b["id"], c["id"]}
    assert rows[b["id"]]["status"] == "PAUSED"
    assert rows[a["id"]]["status"] in ("UNKNOWN", "UP")
    assert rows[a["id"]]["name"] == "SW1"
    assert set(rows[a["id"]]) >= {"status", "since", "results", "latency", "consecutive_failures"}


def test_status_for_device_without_state_is_unknown_or_paused(client):
    a = make(client)
    b = make(client, name="SW2", enabled=False)
    container = client.app.state.container
    container.store.remove(a["id"])
    container.store.remove(b["id"])
    rows = {s["device_id"]: s for s in client.get("/api/status").json()}
    assert rows[a["id"]]["status"] == "UNKNOWN" and rows[a["id"]]["since"] is None
    assert rows[b["id"]]["status"] == "PAUSED"


def test_status_reflects_monitor_cycle(client):
    d = make(client)
    deadline = time.time() + 5
    while time.time() < deadline:
        row = [s for s in client.get("/api/status").json() if s["device_id"] == d["id"]][0]
        if row["status"] == "UP":
            break
        time.sleep(0.1)
    assert row["status"] == "UP" and row["results"][0]["label"] == "ping"
    assert row["latency"] and row["latency"][-1] == 1.5


def test_delete_device_then_list_events(client):
    d = make(client)
    deadline = time.time() + 5
    while time.time() < deadline and not client.get("/api/events").json():
        time.sleep(0.1)
    events = client.get("/api/events").json()
    assert events and events[0]["device_id"] == d["id"]
    client.delete(f"/api/devices/{d['id']}")
    after = client.get("/api/events").json()
    assert len(after) == len(events) and after[0]["device_id"] is None
    assert client.get("/api/status").json() == []


BAD_SNMP = {"version": "v3", "user": "mon", "auth_proto": "SHA", "auth_key": "short",
            "community": "TOPSECRET"}


def test_validation_errors_do_not_echo_secrets(client):
    r = client.post("/api/devices", json={**SW, "snmp": BAD_SNMP})
    assert r.status_code == 422
    assert "short" not in r.text and "TOPSECRET" not in r.text
    assert r.json()["detail"][0]["loc"] and r.json()["detail"][0]["msg"]
    d = make(client, name="SW9")
    r = client.put(f"/api/devices/{d['id']}", json={"snmp": BAD_SNMP})
    assert r.status_code == 422
    assert "short" not in r.text and "TOPSECRET" not in r.text
