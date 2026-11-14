import logging

import uvicorn

from app.config import Settings
from app.main import create_app

log = logging.getLogger("app")


def main() -> None:
    settings = Settings.from_env()
    if settings.debug:
        # NetPulse's own debug messages; third-party libraries stay at their defaults.
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(levelname)s:     %(name)s: %(message)s"))
        log.addHandler(handler)
        log.setLevel(logging.DEBUG)
        log.warning("debug mode is on: API docs at /docs, tracebacks in error responses. "
                    "Do not use it in production.")
    uvicorn.run(
        create_app(settings),
        host=settings.host,
        port=settings.port,
        log_level="debug" if settings.debug else "info",
        access_log=settings.debug,  # one line per request: useful while developing, noise otherwise
        timeout_graceful_shutdown=3,  # do not hang on open SSE streams at Ctrl+C
    )


if __name__ == "__main__":
    main()
