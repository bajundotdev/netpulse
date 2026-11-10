from contextlib import asynccontextmanager
from dataclasses import dataclass
from functools import partial

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import sessionmaker

from app.api import routes, sse
from app.api.sse import SseBroadcaster
from app.config import REPO_ROOT, Settings
from app.infra.bus import EventBus
from app.infra.crypto import SecretBox
from app.infra.db import make_session_factory
from app.infra.repositories import (
    CheckRepository,
    DeviceRepository,
    DuplicateNameError,
    EventRepository,
    NotFoundError,
)
from app.monitoring.factory import CheckerFactory, default_factory
from app.monitoring.monitor import Monitor
from app.monitoring.snmp_client import PysnmpClient
from app.monitoring.status_store import StatusStore
from app.services.devices import DeviceService, ValidationFailed
from app.services.events import EventLogWriter, EventService

WEB_DIST = REPO_ROOT / "web" / "dist"


@dataclass
class Container:
    settings: Settings
    session_factory: sessionmaker
    bus: EventBus
    store: StatusStore
    monitor: Monitor
    snmp_client: PysnmpClient
    broadcaster: SseBroadcaster
    devices: DeviceService
    events: EventService


def _build_container(settings: Settings, factory: CheckerFactory | None) -> Container:
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    box = SecretBox(settings.key_path)
    session_factory = make_session_factory(settings.db_path)
    device_repo = DeviceRepository(session_factory, box)
    check_repo = CheckRepository(session_factory)
    event_repo = EventRepository(session_factory)

    bus = EventBus()
    store = StatusStore()
    bus.subscribe("domain_event", EventLogWriter(event_repo, bus).handle)
    broadcaster = SseBroadcaster()
    for topic in ("status", "result", "event"):
        bus.subscribe(topic, partial(broadcaster.handle, topic))

    snmp_client = PysnmpClient()
    monitor = Monitor(factory or default_factory(snmp_client), store, bus)
    return Container(
        settings=settings,
        session_factory=session_factory,
        bus=bus,
        store=store,
        monitor=monitor,
        snmp_client=snmp_client,
        broadcaster=broadcaster,
        devices=DeviceService(device_repo, check_repo, monitor, store),
        events=EventService(event_repo),
    )


def create_app(
    settings: Settings | None = None,
    *,
    factory: CheckerFactory | None = None,
    start_monitor: bool = True,
) -> FastAPI:
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        c = _build_container(settings, factory)
        app.state.container = c
        try:
            if start_monitor:
                await c.monitor.start(await c.devices.configs())
            yield
        finally:
            await c.monitor.stop()
            c.snmp_client.close()
            c.session_factory.kw["bind"].dispose()

    app = FastAPI(title="NetPulse", lifespan=lifespan)

    @app.exception_handler(NotFoundError)
    async def _not_found(_: Request, exc: NotFoundError) -> JSONResponse:
        return JSONResponse({"detail": f"{exc} not found"}, status_code=404)

    @app.exception_handler(DuplicateNameError)
    async def _duplicate(_: Request, exc: DuplicateNameError) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=409)

    @app.exception_handler(ValidationFailed)
    async def _invalid(_: Request, exc: ValidationFailed) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=422)

    @app.exception_handler(RequestValidationError)
    async def _invalid_request(_: Request, exc: RequestValidationError) -> JSONResponse:
        # Drop pydantic's `input`/`ctx`: they would echo write-only SNMP secrets.
        errors = [{"loc": e["loc"], "msg": e["msg"], "type": e["type"]} for e in exc.errors()]
        return JSONResponse({"detail": errors}, status_code=422)

    app.include_router(routes.router, prefix="/api")
    app.include_router(sse.router, prefix="/api")
    if WEB_DIST.is_dir():
        app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")
    return app
