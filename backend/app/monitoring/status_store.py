from collections import deque

from app.domain.models import CheckResult
from app.domain.state import DeviceState

LATENCY_SAMPLES = 60


class StatusStore:
    def __init__(self) -> None:
        self._states: dict[int, DeviceState] = {}
        self._results: dict[int, list[CheckResult]] = {}
        self._latency: dict[int, deque[float | None]] = {}

    def state(self, device_id: int) -> DeviceState | None:
        return self._states.get(device_id)

    def set_state(self, device_id: int, state: DeviceState) -> None:
        self._states[device_id] = state

    def set_results(self, device_id: int, results: list[CheckResult]) -> None:
        self._results[device_id] = list(results)

    def results(self, device_id: int) -> list[CheckResult]:
        return list(self._results.get(device_id, []))

    def add_latency(self, device_id: int, ms: float | None) -> None:
        self._latency.setdefault(device_id, deque(maxlen=LATENCY_SAMPLES)).append(ms)

    def latency(self, device_id: int) -> list[float | None]:
        return list(self._latency.get(device_id, []))

    def remove(self, device_id: int) -> None:
        self._states.pop(device_id, None)
        self._results.pop(device_id, None)
        self._latency.pop(device_id, None)
