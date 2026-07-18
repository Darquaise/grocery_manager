"""In-process "kitchen data changed" fan-out for the SSE live-update endpoint.

One revision counter per kitchen. Every successful mutation bumps it (via the
middleware in `main.py`, plus explicit bumps for the few mutations whose URL is
not kitchen-scoped), and every subscribed client gets the new revision pushed.
The payload is intentionally content-free — clients react by re-fetching what
they display, so cross-domain side effects (a stock change creating an auto
shopping entry, a trip materialising stock, …) can never be missed.

In-process state is correct here: production runs a single uvicorn process
(see Dockerfile). Revisions reset on restart, which is fine — clients also
refresh on every (re)connect, so nothing is lost.
"""

import asyncio
import threading


class KitchenEventBus:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        # The server's event loop; attached once at startup (lifespan).
        # Mutating endpoints are sync (run in the threadpool), so delivering to
        # subscriber queues must hop onto the loop via call_soon_threadsafe.
        self._loop: asyncio.AbstractEventLoop | None = None
        self._revisions: dict[int, int] = {}
        self._queues: dict[int, set[asyncio.Queue[int]]] = {}

    def attach_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        with self._lock:
            self._loop = loop

    def revision(self, kitchen_id: int) -> int:
        with self._lock:
            return self._revisions.get(kitchen_id, 0)

    def bump(self, kitchen_id: int) -> None:
        """Record a change and notify subscribers. Safe from any thread."""
        with self._lock:
            rev = self._revisions.get(kitchen_id, 0) + 1
            self._revisions[kitchen_id] = rev
            loop = self._loop
        if loop is not None and not loop.is_closed():
            loop.call_soon_threadsafe(self._notify, kitchen_id, rev)

    def _notify(self, kitchen_id: int, rev: int) -> None:
        for queue in tuple(self._queues.get(kitchen_id, ())):
            queue.put_nowait(rev)

    # subscribe/unsubscribe run inside the async SSE endpoint (on the loop).

    def subscribe(self, kitchen_id: int) -> asyncio.Queue[int]:
        queue: asyncio.Queue[int] = asyncio.Queue()
        self._queues.setdefault(kitchen_id, set()).add(queue)
        return queue

    def unsubscribe(self, kitchen_id: int, queue: asyncio.Queue[int]) -> None:
        queues = self._queues.get(kitchen_id)
        if queues is None:
            return
        queues.discard(queue)
        if not queues:
            del self._queues[kitchen_id]


bus = KitchenEventBus()
