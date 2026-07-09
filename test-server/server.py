"""DoodleBot AI-Live test server.

A small FastAPI stand-in for the real backend, built to exercise the SvelteKit
client in ``src/routes/+page.svelte``. It models the same moving parts the real
service will have so the client can be developed against realistic behaviour:

  * a ``Manager`` that owns every client and the sketches they submitted;
  * automatic approval + cross-client grouping of sketches into trios;
  * "vectorization" of a completed trio (rendered from a bundled sample so we
    don't need a real vectorizer), after which every client owning a sketch in
    the trio is notified;
  * a per-client Server-Sent-Events feed that first replays a returning client's
    sketch history (oldest -> newest) and then streams live updates.

Routes
------
  GET  /client                 -> { "client": "<uuid>" }
  POST /sketch                 -> { "sketch": "<sha256>" }   (body: client + data URL)
  GET  /resource/{resource_id} -> the sketch PNG or the vectorization SVG
  GET  /events?client=<id>     -> text/event-stream of SSEPayload objects

Run with:
  uvicorn server:app --reload --port 8000     (from the test-server/ directory)
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import uuid
from dataclasses import dataclass, field
from itertools import cycle
from pathlib import Path
from typing import AsyncIterator, Iterator, Literal

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from turtle_svg import DrawCommand, RenderOptions, render_to_svg

# --- Timings ---------------------------------------------------------------
# Small delays so the client visibly moves through each pipeline stage rather
# than snapping straight to "complete".
REVIEW_DELAY = 1.5  # approval-pending -> approved
GROUP_DELAY = 1.0  # approved -> companions delivered (combining)
COMBINE_DELAY = 2.0  # combining -> vectorization delivered (robot-selection)
ROBOT_DELAY = 1.5  # robot-selection -> complete
HEARTBEAT = 15.0  # seconds between SSE keep-alive comments

# How many approved sketches make a trio that can be vectorized together.
TRIO_SIZE = 3

SAMPLES_DIR = Path(__file__).resolve().parent.parent / "src" / "lib" / "samples"


# --- Wire types (must mirror the client's types in +page.svelte) -----------

SketchStatus = Literal["approved", "innapropriate", "complex"]
RobotKind = Literal["doughnut"]


class SSEPayload(BaseModel):
    """One update pushed to a client over the SSE feed. Matches the client's
    ``SSEPayload`` type exactly, including the (intentional) ``innapropriate``
    spelling. Optional fields are omitted on the wire via ``exclude_none``."""

    sketch: str
    status: SketchStatus | None = None
    companions: list[str] | None = None
    vectorization: str | None = None
    robot: RobotKind | None = None

    def encode(self) -> str:
        return self.model_dump_json(exclude_none=True)


class ClientResponse(BaseModel):
    client: str


class SketchRequest(BaseModel):
    client: str
    """The image content, as a ``data:image/png;base64,...`` URL exported by the
    client's SketchPad."""
    sketch: str


class SketchResponse(BaseModel):
    sketch: str


# --- Server-side domain model ---------------------------------------------

# The pipeline states the server drives a sketch through. Mirrors the client's
# ScreenId so the two stay conceptually in lock-step.
ServerState = Literal[
    "approval-pending",
    "approved",
    "combining",
    "robot-selection",
    "complete",
]


@dataclass
class Resource:
    """Something the ``/resource`` route can serve directly as an <img> src."""

    content_type: str
    body: bytes


@dataclass
class Sketch:
    id: str
    client_id: str
    state: ServerState = "approval-pending"
    # The full ordered log of every payload emitted for this sketch, so a
    # reconnecting client can be replayed back to the sketch's current state.
    events: list[SSEPayload] = field(default_factory=list)


@dataclass
class Client:
    id: str
    # Sketch ids in submission order (oldest first) — the replay order.
    sketch_ids: list[str] = field(default_factory=list)
    # Live SSE subscribers. A client may briefly have more than one (e.g. a
    # reconnect racing an old connection's teardown).
    subscribers: set["asyncio.Queue[str]"] = field(default_factory=set)


class Manager:
    """Single source of truth for clients, their sketches, servable resources,
    and the cross-client grouping of approved sketches into trios."""

    def __init__(self) -> None:
        self.clients: dict[str, Client] = {}
        self.sketches: dict[str, Sketch] = {}
        self.resources: dict[str, Resource] = {}
        # Approved sketch ids awaiting companions, oldest first.
        self.grouping_pool: list[str] = []
        # Round-robin over the bundled samples for each trio's vectorization.
        self._samples: Iterator[list[DrawCommand]] = _sample_cycle()
        # Keep strong references to background tasks so they aren't GC'd.
        self._tasks: set[asyncio.Task[None]] = set()

    # -- clients ------------------------------------------------------------

    def ensure_client(self, client_id: str) -> Client:
        client = self.clients.get(client_id)
        if client is None:
            client = Client(id=client_id)
            self.clients[client_id] = client
        return client

    def subscribe(self, client_id: str) -> "asyncio.Queue[str]":
        """Register a live SSE subscriber and pre-load it with the client's
        replayed history. Synchronous (no awaits) so the snapshot + registration
        is atomic against concurrently-emitted live events."""
        client = self.ensure_client(client_id)
        queue: "asyncio.Queue[str]" = asyncio.Queue()
        client.subscribers.add(queue)
        # Replay every sketch this client owns, oldest -> newest. Because each
        # sketch's first event splices a fresh pipeline to the front of the
        # client's pagination, replaying oldest-first leaves the newest at front.
        for sketch_id in client.sketch_ids:
            for payload in self.sketches[sketch_id].events:
                queue.put_nowait(payload.encode())
        return queue

    def unsubscribe(self, client_id: str, queue: "asyncio.Queue[str]") -> None:
        client = self.clients.get(client_id)
        if client is not None:
            client.subscribers.discard(queue)

    # -- resources ----------------------------------------------------------

    def get_resource(self, resource_id: str) -> Resource | None:
        """In production, this should read from disk (or NFS / s3)"""
        return self.resources.get(resource_id)

    # -- sketches -----------------------------------------------------------

    def store_sketch(self, client_id: str, data_url: str) -> str:
        """Persist a submitted sketch and kick off its pipeline. Returns the
        sha256 content id. Idempotent for a re-submitted identical sketch.

        In production, we'd write the sketches to a file (and eventually s3, but not at the start),
        and thus wouldn't always need to store all sketch full content in memory.
        """
        content_type, body = _decode_data_url(data_url)
        sketch_id = hashlib.sha256(body).hexdigest()

        client = self.ensure_client(client_id)

        if sketch_id in self.sketches:
            # Same content submitted again — hand back the existing id untouched.
            return sketch_id

        self.resources[sketch_id] = Resource(content_type=content_type, body=body)
        sketch = Sketch(id=sketch_id, client_id=client_id)
        self.sketches[sketch_id] = sketch
        client.sketch_ids.append(sketch_id)

        # The creation event materialises the pipeline on the client. (For a
        # live submission the client already created it eagerly and will treat
        # this as a no-op; a reconnecting client needs it to rebuild the model.)
        self._emit(sketch, SSEPayload(sketch=sketch_id))
        self._spawn(self._review(sketch))
        return sketch_id

    # -- event emission -----------------------------------------------------

    def _emit(self, sketch: Sketch, payload: SSEPayload) -> None:
        """Append to the sketch's log and fan out to its owner's live feeds."""
        sketch.events.append(payload)
        data = payload.encode()
        owner = self.clients.get(sketch.client_id)
        if owner is not None:
            for queue in owner.subscribers:
                queue.put_nowait(data)

    # -- pipeline orchestration --------------------------------------------

    async def _review(self, sketch: Sketch) -> None:
        """Auto-approve after a short review, then try to form a trio.

        A real backend would classify here and could emit ``innapropriate`` /
        ``complex`` instead; this test server approves everything so the
        grouping + vectorization path is always reachable."""
        await asyncio.sleep(REVIEW_DELAY)
        sketch.state = "approved"
        self._emit(sketch, SSEPayload(sketch=sketch.id, status="approved"))

        # A newly-approved sketch joins the waiting pool; whenever enough are
        # waiting they are paired into a trio. This is the "when a sketch is
        # approved, any clients awaiting a companion are paired" behaviour.
        self.grouping_pool.append(sketch.id)
        self._drain_pool()

    def _drain_pool(self) -> None:
        """
        TODO: In the production server,
        sketches should get paired the moment their is more than one in the pool,
        And then when the next one comes online, they will all be notified.

        That way, it goes like this:
        - First submitter: waits for a second, sees first match, then second match some time later
        - Second submitter: immediately sees a match once sketch is approved
        - Third submitter: immediately sees both matches once approved, and moves onto 'combining' state immediately
        """
        while len(self.grouping_pool) >= TRIO_SIZE:
            trio = [self.grouping_pool.pop(0) for _ in range(TRIO_SIZE)]
            self._spawn(self._combine(trio))

    async def _combine(self, trio_ids: list[str]) -> None:
        trio = [self.sketches[sid] for sid in trio_ids]

        # 1) Tell every member who its two companions are. The client pairs both
        #    images and moves into the "combining" state.
        await asyncio.sleep(GROUP_DELAY)
        for sketch in trio:
            companions = [other.id for other in trio if other.id != sketch.id]
            sketch.state = "combining"
            self._emit(sketch, SSEPayload(sketch=sketch.id, companions=companions))

        # 2) Vectorize the trio into a single combined drawing and hand every
        #    member the same vectorization resource.
        await asyncio.sleep(COMBINE_DELAY)
        vectorization_id = self._make_vectorization()
        for sketch in trio:
            sketch.state = "robot-selection"
            self._emit(
                sketch, SSEPayload(sketch=sketch.id, vectorization=vectorization_id)
            )

        # 3) Assign the finished drawing to a robot and complete the pipeline.
        await asyncio.sleep(ROBOT_DELAY)
        for sketch in trio:
            sketch.state = "complete"
            self._emit(sketch, SSEPayload(sketch=sketch.id, robot="doughnut"))

    def _make_vectorization(self) -> str:
        """Render the next bundled sample to an SVG, store it as a servable
        resource, and return its content-addressed id."""
        commands = next(self._samples)
        svg = render_to_svg(commands, RenderOptions(stroke="#2b2f3a", stroke_width=13))
        body = svg.encode("utf-8")
        resource_id = hashlib.sha256(body).hexdigest()
        self.resources[resource_id] = Resource(content_type="image/svg+xml", body=body)
        return resource_id

    # -- task bookkeeping ---------------------------------------------------

    def _spawn(self, coro: "asyncio.Future[None] | AsyncIterator[None]") -> None:
        task = asyncio.ensure_future(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)


# --- helpers ---------------------------------------------------------------


def _decode_data_url(data_url: str) -> tuple[str, bytes]:
    """Split a ``data:<mime>;base64,<payload>`` URL into (mime, bytes)."""
    if not data_url.startswith("data:"):
        raise HTTPException(status_code=400, detail="sketch must be a data URL")
    header, _, encoded = data_url.partition(",")
    if not encoded:
        raise HTTPException(status_code=400, detail="malformed data URL")
    mime = header[len("data:") :].split(";")[0] or "application/octet-stream"
    try:
        body = base64.b64decode(encoded)
    except Exception as exc:  # noqa: BLE001 - surface any decode failure as 400
        raise HTTPException(status_code=400, detail="invalid base64 payload") from exc
    return mime, body


def _sample_cycle() -> Iterator[list[DrawCommand]]:
    """Endlessly cycle over the bundled sample command lists."""
    paths = sorted(SAMPLES_DIR.glob("*.json"))
    if not paths:
        raise RuntimeError(f"no sample .json files found in {SAMPLES_DIR}")
    samples = [json.loads(path.read_text()) for path in paths]
    return cycle(samples)


# --- app -------------------------------------------------------------------

app = FastAPI(title="DoodleBot AI-Live test server")

# The client typically runs on the Vite dev origin (e.g. :5173) while this
# server runs elsewhere (:8000), so allow cross-origin requests + EventSource.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

manager = Manager()


@app.get("/client", response_model=ClientResponse)
async def request_client() -> ClientResponse:
    """Mint a fresh client id. (The client persists this and reuses it so its
    sketch history can be replayed on reconnect.)

    In production, should this be checked to be unique via the manager?
    """
    return ClientResponse(client=uuid.uuid4().hex)


@app.post("/sketch", response_model=SketchResponse)
async def store_sketch(request: SketchRequest) -> SketchResponse:
    sketch_id = manager.store_sketch(request.client, request.sketch)
    return SketchResponse(sketch=sketch_id)


@app.get("/resource/{resource_id}")
async def get_resource(resource_id: str) -> Response:
    resource = manager.get_resource(resource_id)
    if resource is None:
        raise HTTPException(status_code=404, detail="unknown resource")
    return Response(
        content=resource.body,
        media_type=resource.content_type,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@app.get("/events")
async def events(
    request: Request, client: str = Query(..., description="client id")
) -> StreamingResponse:
    """SSE feed for one client: replayed history first, then live updates."""
    queue = manager.subscribe(client)

    async def stream() -> AsyncIterator[str]:
        try:
            yield ": connected\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    data = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT)
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"  # comment frame; ignored by EventSource
                    continue
                yield f"data: {data}\n\n"
        finally:
            manager.unsubscribe(client, queue)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
