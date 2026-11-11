from typing import Annotated, Literal

from fastapi import APIRouter, Query, Request, Response

from app.schemas import (
    CheckIn,
    CheckOut,
    DeviceIn,
    DeviceOut,
    DeviceStatusOut,
    DeviceUpdate,
    EventOut,
    HistoryOut,
    ResultOut,
    Severity,
)
from app.services.devices import DeviceService
from app.services.events import EventService
from app.services.history import HistoryService

router = APIRouter()


def _devices(request: Request) -> DeviceService:
    return request.app.state.container.devices


def _events(request: Request) -> EventService:
    return request.app.state.container.events


def _history(request: Request) -> HistoryService:
    return request.app.state.container.history_service


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/devices")
async def list_devices(request: Request) -> list[DeviceOut]:
    return await _devices(request).list()


@router.post("/devices", status_code=201)
async def create_device(data: DeviceIn, request: Request) -> DeviceOut:
    return await _devices(request).create(data)


@router.get("/devices/{device_id}")
async def get_device(device_id: int, request: Request) -> DeviceOut:
    return await _devices(request).get(device_id)


@router.put("/devices/{device_id}")
async def update_device(device_id: int, data: DeviceUpdate, request: Request) -> DeviceOut:
    return await _devices(request).update(device_id, data)


@router.delete("/devices/{device_id}", status_code=204)
async def delete_device(device_id: int, request: Request) -> Response:
    await _devices(request).delete(device_id)
    return Response(status_code=204)


@router.post("/devices/{device_id}/test")
async def test_device(device_id: int, request: Request) -> list[ResultOut]:
    return await _devices(request).test(device_id)


@router.get("/devices/{device_id}/checks")
async def list_checks(device_id: int, request: Request) -> list[CheckOut]:
    return await _devices(request).list_checks(device_id)


@router.post("/devices/{device_id}/checks", status_code=201)
async def add_check(device_id: int, data: CheckIn, request: Request) -> CheckOut:
    return await _devices(request).add_check(device_id, data)


@router.put("/checks/{check_id}")
async def update_check(check_id: int, data: CheckIn, request: Request) -> CheckOut:
    return await _devices(request).update_check(check_id, data)


@router.delete("/checks/{check_id}", status_code=204)
async def delete_check(check_id: int, request: Request) -> Response:
    await _devices(request).delete_check(check_id)
    return Response(status_code=204)


@router.get("/status")
async def status(request: Request) -> list[DeviceStatusOut]:
    return await _devices(request).status()


@router.get("/events")
async def list_events(
    request: Request,
    device_id: int | None = None,
    severity: Severity | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    before_id: int | None = None,
) -> list[EventOut]:
    return await _events(request).list(device_id, severity, limit, before_id)


@router.post("/events/{event_id}/ack", status_code=204)
async def ack_event(event_id: int, request: Request) -> Response:
    await _events(request).ack(event_id)
    return Response(status_code=204)


@router.delete("/events")
async def clear_events(request: Request) -> dict[str, int]:
    return {"deleted": await _events(request).clear()}


@router.get("/history")
async def get_history(
    request: Request, range: Literal["1h", "24h", "7d"] = "24h"
) -> HistoryOut:
    return HistoryOut(**await _history(request).get(range))
