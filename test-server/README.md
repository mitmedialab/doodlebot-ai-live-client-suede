# DoodleBot AI-Live test server

A small FastAPI stand-in for the real backend, used to develop and exercise the
SvelteKit client in [`src/routes/+page.svelte`](../src/routes/+page.svelte). It
models the real service's moving parts so the client sees realistic behaviour.

## Run it

```bash
cd test-server
pip install -r requirements.txt
uvicorn server:app --reload --port 8000
```

Then start the client:

```bash
npm run dev            # from the repo root, serves on :5173
```

Open <http://localhost:5173/>.

The Vite dev server **proxies** the API routes (`/client`, `/sketch`, `/resource`,
`/events`) to the test server on `:8000` (see `vite.config.ts`), so the browser
only ever talks to the Vite origin. This matters in a devcontainer: only the port
you open (`5173`) is forwarded to your host, so a page that reached out to a
second origin like `http://localhost:8000` directly would fail from the host
browser (that port isn't forwarded) even though it works inside the container.
The proxy sidesteps that entirely — no need to forward `:8000` or pass `?server=`.
If the test server runs elsewhere, point the proxy at it with `TEST_SERVER=...`.

To bypass the proxy and hit a server on a different origin directly (requires
that origin to be reachable from the browser), pass `?server=http://host:port`.

## Routes

| Route | Purpose |
| --- | --- |
| `GET /client` | Mint a fresh client id (the client persists it in `localStorage`). |
| `POST /sketch` | Body `{ client, sketch }` where `sketch` is the PNG data URL from the SketchPad. Returns `{ sketch }`, the **sha256 of the image bytes**. |
| `GET /resource/{id}` | Serves a stored sketch PNG or a vectorization SVG directly for `<img src>`. |
| `GET /events?client={id}` | SSE feed. A returning client's sketch history is replayed first (oldest → newest), then live updates stream. |

The SSE payload type mirrors the client's `SSEPayload` exactly (including the
intentional `innapropriate` spelling); optional fields are omitted on the wire.

## Behaviour

The [`Manager`](server.py) owns every client and its sketches. When a sketch is
submitted it is auto-approved after a short review and joins a global pool; once
`TRIO_SIZE` (3) approved sketches are waiting they are paired into a trio. Each
member is told its two companions, the trio is "vectorized" (rendered from a
bundled `src/lib/samples/*.json` via [`turtle_svg.py`](turtle_svg.py), a port of
`src/lib/utils/turtle-svg.ts`), and finally every member is assigned a robot —
notifying every client that owns a sketch in the trio.

To exercise a reject path, change `Manager._review` to emit `status="complex"`
or `status="innapropriate"` instead of `"approved"`.

## Smoke test

With the server running:

```bash
python3 e2e_check.py
```

Drives 3 clients through the full pipeline, checks the resource route serves both
PNGs and the vectorization SVG, and verifies reconnect replay.
```
```

### Notes / limitations

- State is in-memory: restarting the server forgets all clients and sketches, so
  a client's history can only be replayed within a single server lifetime.
- Sketch ids are content hashes, so two clients submitting byte-identical images
  would collide on one server-side sketch. Freehand drawings differ in practice.
