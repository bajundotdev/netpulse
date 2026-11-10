from datetime import UTC, datetime

from app.domain.models import DomainEvent, EventKind, Severity
from app.infra.repositories import EventRepository


def seed(client, n=3):
    repo = EventRepository(client.app.state.container.session_factory)
    for i in range(n):
        repo.add(
            DomainEvent(
                device_id=None,
                severity=Severity.CRITICAL if i % 2 == 0 else Severity.INFO,
                kind=EventKind.STATUS_CHANGE,
                message=f"m{i}",
                ts=datetime(2026, 1, 1, tzinfo=UTC),
            )
        )


def test_events_newest_first_filter_and_paging(client):
    seed(client, 5)
    events = client.get("/api/events").json()
    assert [e["message"] for e in events] == ["m4", "m3", "m2", "m1", "m0"]
    assert events[0]["ts"].startswith("2026-01-01T00:00:00")
    crit = client.get("/api/events", params={"severity": "critical"}).json()
    assert [e["message"] for e in crit] == ["m4", "m2", "m0"]
    page = client.get("/api/events", params={"limit": 2}).json()
    assert len(page) == 2
    nxt = client.get("/api/events", params={"limit": 2, "before_id": page[-1]["id"]}).json()
    assert [e["message"] for e in nxt] == ["m2", "m1"]


def test_events_bad_query_is_422(client):
    assert client.get("/api/events", params={"severity": "nope"}).status_code == 422
    assert client.get("/api/events", params={"limit": 0}).status_code == 422


def test_events_ack_and_clear(client):
    seed(client, 2)
    first = client.get("/api/events").json()[0]
    assert first["acknowledged"] is False
    assert client.post(f"/api/events/{first['id']}/ack").status_code == 204
    assert client.get("/api/events").json()[0]["acknowledged"] is True
    assert client.post("/api/events/999/ack").status_code == 404
    assert client.delete("/api/events").json() == {"deleted": 2}
    assert client.get("/api/events").json() == []
