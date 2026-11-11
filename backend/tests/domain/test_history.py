from datetime import UTC, datetime, timedelta

from app.domain.history import RANGES, bucketize, overall, uptime_pct, window, worst

BASE = datetime(2026, 11, 11, 12, 0, tzinfo=UTC)


def t(minutes: float) -> datetime:
    return BASE + timedelta(minutes=minutes)


NOW = t(60)


def test_ranges_are_window_and_slot_seconds():
    assert RANGES == {"1h": (3600, 60), "24h": (86400, 900), "7d": (604800, 7200)}


def test_window_rounds_end_up_to_slot_and_counts_slots():
    start, end, b = window("24h", datetime(2026, 11, 11, 5, 7, tzinfo=UTC))
    assert (b, end) == (900, datetime(2026, 11, 11, 5, 15, tzinfo=UTC))
    assert (end - start) == timedelta(hours=24)


def test_window_on_a_boundary_stays_put():
    now = datetime(2026, 11, 11, 5, 15, tzinfo=UTC)
    assert window("24h", now)[1] == now


def test_window_unknown_key_raises():
    try:
        window("30d", NOW)
    except KeyError:
        return
    raise AssertionError("expected KeyError")


def test_status_holds_until_next_row():
    s = bucketize([(t(-10), "UP"), (t(30), "DOWN")], t(0), t(60), 600, NOW)
    assert s == ["UP", "UP", "UP", "DOWN", "DOWN", "DOWN"]


def test_worst_status_wins_inside_a_slot():
    s = bucketize([(t(0), "UP"), (t(3), "DOWN"), (t(4), "UP")], t(0), t(10), 600, NOW)
    assert s == ["DOWN"]


def test_degraded_beats_up_paused_only_when_nothing_else():
    assert worst(["UP", "DEGRADED", "PAUSED"]) == "DEGRADED"
    assert worst(["PAUSED", None]) == "PAUSED"
    assert worst([None, "STOPPED", "UNKNOWN"]) is None


def test_device_added_mid_window_has_leading_none_and_full_uptime():
    tr = [(t(30), "UNKNOWN"), (t(30.1), "UP")]
    assert bucketize(tr, t(0), t(60), 600, NOW)[:3] == [None, None, None]
    assert uptime_pct(tr, t(0), t(60), NOW) == 100.0


def test_uptime_excludes_paused_stopped_unknown():
    tr = [(t(0), "UP"), (t(20), "DOWN"), (t(30), "PAUSED"), (t(40), "STOPPED"), (t(50), "UP")]
    assert uptime_pct(tr, t(0), t(60), NOW) == 75.0  # UP 30 min of 40 counted


def test_uptime_is_rounded_to_two_decimals():
    tr = [(t(0), "UP"), (t(20), "DOWN")]
    assert uptime_pct(tr, t(0), t(60), NOW) == 33.33


def test_no_rows_gives_all_none_and_no_uptime():
    assert bucketize([], t(0), t(60), 600, NOW) == [None] * 6
    assert uptime_pct([], t(0), t(60), NOW) is None


def test_slots_after_now_are_none():
    now = t(25)
    s = bucketize([(t(0), "UP")], t(0), t(60), 600, now)
    assert s == ["UP", "UP", "UP", None, None, None]
    assert uptime_pct([(t(0), "UP"), (t(20), "DOWN")], t(0), t(60), now) == 80.0


def test_partial_last_slot_counts_only_time_before_now():
    now = t(25)
    s = bucketize([(t(0), "UP"), (t(27), "DOWN")], t(0), t(60), 600, now)
    assert s[2] == "UP"


def test_overall_counts_problem_devices_and_worst_status():
    problems, status = overall([["UP", "DOWN", None], ["DEGRADED", "DOWN", None]])
    assert problems == [1, 2, 0] and status == ["DEGRADED", "DOWN", None]


def test_overall_of_no_devices_is_empty():
    assert overall([]) == ([], [])


def test_bucketize_is_linear_over_many_transitions():
    import time

    from app.domain.history import bucketize, window

    now = datetime(2026, 11, 11, 5, 0, tzinfo=UTC)
    start, end, bucket_s = window("7d", now)
    # Alternating UP/DOWN every 30 seconds for 7 days+: every 2-hour slot has a DOWN.
    base = start - timedelta(minutes=10)
    rows = [(base + timedelta(seconds=30 * i), "UP" if i % 2 == 0 else "DOWN") for i in range(20200)]
    began = time.perf_counter()
    slots = bucketize(rows, start, end, bucket_s, now)
    elapsed = time.perf_counter() - began
    assert len(slots) == 84
    assert slots == ["DOWN"] * 84
    assert elapsed < 0.05, elapsed
