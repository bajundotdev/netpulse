import threading

from app.infra.dbexec import DbRunner


async def test_db_runner_uses_one_dedicated_thread():
    runner = DbRunner()
    try:
        names = {await runner(lambda: threading.current_thread().name) for _ in range(3)}
        assert len(names) == 1 and names.pop().startswith("netpulse-db")
        assert await runner(max, 2, 5) == 5
    finally:
        runner.shutdown()
