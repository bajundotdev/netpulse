import uvicorn

from app.config import Settings
from app.main import create_app


def main() -> None:
    settings = Settings.from_env()
    uvicorn.run(
        create_app(settings),
        host=settings.host,
        port=settings.port,
        timeout_graceful_shutdown=3,  # do not hang on open SSE streams at Ctrl+C
    )


if __name__ == "__main__":
    main()
