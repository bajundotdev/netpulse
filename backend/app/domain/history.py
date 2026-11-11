"""Pure history maths: status changes -> time slots and uptime. No I/O."""

from collections.abc import Iterable
from datetime import UTC, datetime, timedelta

# range key -> (window seconds, slot seconds)
RANGES: dict[str, tuple[int, int]] = {
    "1h": (3600, 60),
    "24h": (86400, 900),
    "7d": (604800, 7200),
}

Transition = tuple[datetime, str]

_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
_PROBLEM = ("DOWN", "DEGRADED")
_RANKED = ("DOWN", "DEGRADED", "UP")


def window(range_key: str, now: datetime) -> tuple[datetime, datetime, int]:
    """Return (start, end, slot_seconds); end is now rounded up to a slot boundary."""
    window_s, bucket_s = RANGES[range_key]
    elapsed = (now - _EPOCH).total_seconds()
    end = _EPOCH + timedelta(seconds=-(-elapsed // bucket_s) * bucket_s)
    return end - timedelta(seconds=window_s), end, bucket_s


def _segments(
    transitions: list[Transition], start: datetime, limit: datetime
) -> list[tuple[datetime, datetime, str]]:
    """Intervals [from, to) of constant status, clipped to [start, limit)."""
    rows = sorted(transitions, key=lambda r: r[0])
    out: list[tuple[datetime, datetime, str]] = []
    for i, (ts, status) in enumerate(rows):
        seg_end = rows[i + 1][0] if i + 1 < len(rows) else limit
        seg_start = max(ts, start)
        seg_end = min(seg_end, limit)
        if seg_start < seg_end:
            out.append((seg_start, seg_end, status))
    return out


def worst(values: Iterable[str | None]) -> str | None:
    """DOWN > DEGRADED > UP; otherwise PAUSED if present; otherwise None."""
    seen = set(values)
    for status in _RANKED:
        if status in seen:
            return status
    return "PAUSED" if "PAUSED" in seen else None


def bucketize(
    transitions: list[Transition],
    start: datetime,
    end: datetime,
    bucket_s: int,
    now: datetime,
) -> list[str | None]:
    segments = _segments(transitions, start, min(end, now))
    step = timedelta(seconds=bucket_s)
    slots: list[str | None] = []
    slot_start = start
    first = 0  # segments are sorted and disjoint: skip those already behind the slot
    while slot_start < end:
        slot_end = slot_start + step
        while first < len(segments) and segments[first][1] <= slot_start:
            first += 1
        seen = []
        for seg_start, _seg_end, status in segments[first:]:
            if seg_start >= slot_end:
                break
            seen.append(status)
        slots.append(worst(seen))
        slot_start = slot_end
    return slots


def uptime_pct(
    transitions: list[Transition], start: datetime, end: datetime, now: datetime
) -> float | None:
    up = 0.0
    counted = 0.0
    for seg_start, seg_end, status in _segments(transitions, start, min(end, now)):
        seconds = (seg_end - seg_start).total_seconds()
        if status == "UP":
            up += seconds
            counted += seconds
        elif status in _PROBLEM:
            counted += seconds
    if counted == 0:
        return None
    return round(up / counted * 100, 2)


def overall(per_device: list[list[str | None]]) -> tuple[list[int], list[str | None]]:
    """Per slot: number of devices in DOWN/DEGRADED, and the worst status."""
    columns = list(zip(*per_device, strict=True))
    problems = [sum(1 for v in col if v in _PROBLEM) for col in columns]
    return problems, [worst(col) for col in columns]
