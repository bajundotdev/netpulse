from datetime import UTC, datetime, timedelta

import pytest

from app.infra.db import StatusHistoryRow
from app.infra.repositories import DeviceRepository, EventRepository, StatusHistoryRepository
from app.domain.models import DomainEvent, EventKind, Severity

T = datetime(2026, 11, 11, 12, 0, tzinfo=UTC)


def at(seconds: int) -> datetime:
    return T + timedelta(seconds=seconds)


@pytest.fixture
def devices(session_factory, secret_box):
    return DeviceRepository(session_factory, secret_box)


@pytest.fixture
def events(session_factory):
    return EventRepository(session_factory)


@pytest.fixture
def repo(session_factory, devices):
    devices.create({"name": "A", "host": "10.0.0.1"})
    devices.create({"name": "B", "host": "10.0.0.2"})
    return StatusHistoryRepository(session_factory)


def count(session_factory) -> int:
    with session_factory() as s:
        return s.query(StatusHistoryRow).count()


def test_window_rows_include_last_row_before_start(repo):
    repo.add(1, "UP", at(-120))
    repo.add(1, "DOWN", at(-10))
    repo.add(1, "UP", at(5))
    rows = repo.window_rows(T, at(60))
    assert rows == {1: [(at(-10), "DOWN"), (at(5), "UP")]}
    assert rows[1][0][0].tzinfo is UTC


def test_window_rows_exclude_after_end_and_keep_insert_order_on_ties(repo):
    repo.add(1, "UP", at(10))
    repo.add(1, "DOWN", at(10))
    repo.add(1, "UP", at(61))
    repo.add(2, "UP", at(-5))
    rows = repo.window_rows(T, at(60))
    assert rows[1] == [(at(10), "UP"), (at(10), "DOWN")]
    assert rows[2] == [(at(-5), "UP")]


def test_window_rows_omits_devices_without_rows(repo):
    repo.add(1, "UP", at(5))
    assert set(repo.window_rows(T, at(60))) == {1}


def test_problem_entries_count_only_entries_into_problem(repo):
    for i, status in enumerate(["UP", "DOWN", "DOWN", "DEGRADED", "UP", "DOWN"]):
        repo.add(1, status, at(-3000 + i * 100))
    assert repo.problem_entries_since(at(-3600)) == 3


def test_problem_entries_use_previous_row_before_window(repo):
    repo.add(1, "DOWN", at(-7200))
    repo.add(1, "DOWN", at(-60))  # repeat of the previous status: not an entry
    repo.add(2, "UP", at(-7200))
    repo.add(2, "DOWN", at(-60))  # entry
    repo.add(2, "UNKNOWN", at(-30))
    assert repo.problem_entries_since(at(-3600)) == 1


def test_problem_entry_without_previous_row_counts(repo):
    repo.add(1, "DOWN", at(-60))
    assert repo.problem_entries_since(at(-3600)) == 1


def test_prune_keeps_newest_row_before_cutoff(repo, session_factory):
    repo.add(1, "UP", at(-300))
    repo.add(1, "DOWN", at(-200))
    repo.add(1, "UP", at(-100))
    repo.add(1, "DEGRADED", at(10))
    assert repo.prune(T) == 2
    assert repo.window_rows(T, at(60))[1] == [(at(-100), "UP"), (at(10), "DEGRADED")]
    assert count(session_factory) == 2


def test_add_many_and_prune_per_device(repo):
    repo.add_many([1, 2], "STOPPED", at(-100))
    repo.add_many([], "STOPPED", at(-100))
    assert repo.prune(T) == 0
    assert set(repo.window_rows(T, at(60))) == {1, 2}


def test_add_for_missing_device_is_ignored(repo, session_factory):
    repo.add(99, "UP", T)
    repo.add_many([1, 99], "STOPPED", T)
    assert count(session_factory) == 1


def test_delete_device_cascades_history(devices, repo, session_factory):
    repo.add(1, "UP", T)
    repo.add(2, "UP", T)
    devices.delete(1)
    assert count(session_factory) == 1


def test_clear_event_log_leaves_history(events, repo, session_factory):
    repo.add(1, "UP", T)
    events.add(DomainEvent(1, Severity.INFO, EventKind.STATUS_CHANGE, "x"))
    events.clear()
    assert count(session_factory) == 1
