"""In-memory pub/sub of live run events: run_id -> subscriber queues.

# ponytail: in-process hub, single backend replica only; move to Postgres LISTEN/NOTIFY or Redis to scale out.
"""

import asyncio

_subs: dict[int, set[asyncio.Queue]] = {}


def subscribe(run_id: int) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue()
    _subs.setdefault(run_id, set()).add(q)
    return q


def unsubscribe(run_id: int, q: asyncio.Queue) -> None:
    subs = _subs.get(run_id)
    if subs is not None:
        subs.discard(q)
        if not subs:
            del _subs[run_id]


def publish(run_id: int, event: dict | None) -> None:
    """event None = the run task is gone (finished or failed): subscribers should close."""
    for q in _subs.get(run_id, ()):
        q.put_nowait(event)
