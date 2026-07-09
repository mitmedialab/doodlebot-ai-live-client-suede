"""End-to-end smoke test for the DoodleBot AI-Live test server.

Drives 3 clients through the full pipeline (submit -> approve -> group into a
trio -> vectorize -> robot), checks the /resource route serves both PNGs and the
vectorization SVG, and verifies a reconnecting client replays its history.
"""

import base64
import json
import threading
import time
import urllib.request

BASE = "http://localhost:8000"


def _post_json(path, body):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def _get_json(path):
    with urllib.request.urlopen(BASE + path) as r:
        return json.load(r)


def collect_events(client, out, stop):
    """Read the SSE stream for `client`, appending parsed payloads to `out`
    until `stop` is set."""
    req = urllib.request.Request(f"{BASE}/events?client={client}")
    with urllib.request.urlopen(req) as r:
        for raw in r:
            if stop.is_set():
                return
            line = raw.decode().strip()
            if line.startswith("data:"):
                out.append(json.loads(line[len("data:"):].strip()))


def data_url(marker: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(marker).decode()


def main():
    clients = [_get_json("/client")["client"] for _ in range(3)]
    print("clients:", [c[:8] for c in clients])

    streams, stops, threads = [], [], []
    for c in clients:
        out, stop = [], threading.Event()
        t = threading.Thread(target=collect_events, args=(c, out, stop), daemon=True)
        t.start()
        streams.append(out)
        stops.append(stop)
        threads.append(t)

    time.sleep(0.5)  # let the SSE handshakes settle

    sketch_ids = []
    for i, c in enumerate(clients):
        sid = _post_json("/sketch", {"client": c, "sketch": data_url(f"sketch-{i}".encode())})["sketch"]
        sketch_ids.append(sid)
        print(f"client {i} -> sketch {sid[:12]}")

    # Wait for the whole pipeline to run (review + group + combine + robot).
    time.sleep(8)
    for s in stops:
        s.set()

    ok = True
    vec_id = None
    for i, out in enumerate(streams):
        kinds = []
        for p in out:
            if p.get("status"):
                kinds.append(p["status"])
            elif p.get("companions") is not None:
                kinds.append(f"companions={len(p['companions'])}")
            elif p.get("vectorization"):
                kinds.append("vectorization")
                vec_id = p["vectorization"]
            elif p.get("robot"):
                kinds.append(f"robot={p['robot']}")
            else:
                kinds.append("created")
        print(f"client {i} events: {kinds}")
        expected = ["created", "approved", "companions=2", "vectorization", "robot=doughnut"]
        if kinds != expected:
            ok = False
            print(f"  !! expected {expected}")

    # Resource checks: each sketch PNG + the shared vectorization SVG.
    for sid in sketch_ids:
        with urllib.request.urlopen(f"{BASE}/resource/{sid}") as r:
            ct = r.headers["Content-Type"]
            assert ct == "image/png", ct
    with urllib.request.urlopen(f"{BASE}/resource/{vec_id}") as r:
        svg = r.read().decode()
        ct = r.headers["Content-Type"]
    print(f"vectorization content-type={ct}, starts_with_svg={svg.startswith('<svg')}")
    ok = ok and ct == "image/svg+xml" and svg.startswith("<svg") and svg.rstrip().endswith("</svg>")

    # Reconnect replay: a fresh SSE for client 0 should replay its full history.
    replay, stop = [], threading.Event()
    t = threading.Thread(target=collect_events, args=(clients[0], replay, stop), daemon=True)
    t.start()
    time.sleep(1)
    stop.set()
    replay_kinds = [
        "vectorization" if p.get("vectorization") else
        p.get("robot") and f"robot={p['robot']}" or
        (p.get("companions") is not None and f"companions={len(p['companions'])}") or
        p.get("status") or "created"
        for p in replay
    ]
    print(f"client 0 REPLAY: {replay_kinds}")
    ok = ok and replay_kinds == ["created", "approved", "companions=2", "vectorization", "robot=doughnut"]

    print("\nRESULT:", "PASS" if ok else "FAIL")
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
