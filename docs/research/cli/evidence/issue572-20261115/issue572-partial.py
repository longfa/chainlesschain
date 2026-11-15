#!/usr/bin/env python3
# Usage: python3 repro.py /absolute/path/to/codex
# Python stdlib only; synthetic legacy rollouts; no thread/start or turn/start.
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import tempfile
import threading
import uuid

codex = str(Path(sys.argv[1]).resolve())
print(subprocess.check_output([codex, "--version"], text=True).strip())


def case(count, limit, direction, tied):
    with tempfile.TemporaryDirectory(prefix="codex-list-") as tmp:
        root = Path(tmp)
        home, user_home, cwd = [root / p for p in ("codex", "user", "workspace")]
        for p in (home, user_home, cwd):
            p.mkdir()
        (home / "config.toml").write_text(
            'model_provider="fixture"\nmodel="fixture"\n'
            '[model_providers.fixture]\nname="fixture"\n'
            'base_url="http://127.0.0.1:9/v1"\nwire_api="responses"\n'
            'requires_openai_auth=false\n')
        env = {"PATH": os.defpath, "HOME": str(user_home), "CODEX_HOME": str(home)}
        with (root / "stderr.log").open("w+") as err:
            p = subprocess.Popen([codex, "app-server"], env=env, cwd=cwd,
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                 stderr=err, text=True, bufsize=1)
            inbox = queue.Queue()

            def read():
                for line in p.stdout:
                    inbox.put(json.loads(line))
                inbox.put(None)

            threading.Thread(target=read, daemon=True).start()
            sequence = 0

            def rpc(method, params):
                nonlocal sequence
                sequence += 1
                p.stdin.write(json.dumps({"id": sequence, "method": method,
                                          "params": params}) + "\n")
                p.stdin.flush()
                while True:
                    reply = inbox.get(timeout=30)
                    if reply is None:
                        err.seek(0)
                        raise RuntimeError(err.read())
                    if reply.get("id") == sequence:
                        if "error" in reply:
                            raise RuntimeError(reply)
                        return reply["result"]

            try:
                rpc("initialize", {"clientInfo": {"name": "cold-list-repro", "version": "1"},
                                   "capabilities": {"experimentalApi": True}})
                p.stdin.write('{"method":"initialized"}\n')
                p.stdin.flush()
                params = {"limit": limit, "sortKey": "recency_at", "sortDirection": direction,
                          "modelProviders": ["fixture"], "sourceKinds": ["vscode"],
                          "cwd": str(cwd)}
                before_copy = rpc("thread/list", {**params, "useStateDbOnly": True})
                assert before_copy["data"] == []
                sessions = home / "sessions/2026/01/01"
                sessions.mkdir(parents=True)
                expected = [str(uuid.UUID(int=i + 1)) for i in range(count)]
                for i, ident in enumerate(expected):
                    stamp = f"2026-01-01T00:00:{i:02d}.000Z"
                    f = sessions / f"rollout-2026-01-01T00-00-{i:02d}-{ident}.jsonl"
                    rows = [
                        {"timestamp": stamp, "type": "session_meta", "payload": {
                            "id": ident, "timestamp": stamp, "cwd": str(cwd),
                            "originator": "cold-list-repro", "cli_version": "0.167.0",
                            "source": "vscode", "model_provider": "fixture"}},
                        {"timestamp": stamp, "type": "event_msg", "payload": {
                            "type": "user_message", "message": f"fixture {i}"}},
                    ]
                    f.write_text("".join(json.dumps(row) + "\n" for row in rows))
                    mtime = 1767312000 + (0 if tied else i)  # after every creation time
                    os.utime(f, (mtime, mtime))
                after_copy = rpc("thread/list", {**params, "useStateDbOnly": True})
                assert after_copy["data"] == []

                # Seed a proper subset through a single small first scan, then
                # traverse the partially indexed home without a full warmup.
                seed = rpc("thread/list", {**params, "useStateDbOnly": False})
                indexed = rpc("thread/list", {**params, "limit": 100,
                                               "useStateDbOnly": True})
                indexed_ids = [row["id"] for row in indexed["data"]]
                assert 0 < len(indexed_ids) < count, indexed_ids

                def traverse():
                    pages, cursors, query = [], set(), {**params, "useStateDbOnly": False}
                    while True:
                        page = rpc("thread/list", query)
                        pages.append({"ids": [r["id"] for r in page["data"]],
                                      "nextCursor": page["nextCursor"]})
                        cursor = page["nextCursor"]
                        if cursor is None:
                            return pages
                        assert cursor not in cursors and len(pages) <= count + 1
                        cursors.add(cursor)
                        query["cursor"] = cursor

                cold = traverse()
                repaired = rpc("thread/list", {**params, "limit": 100, "useStateDbOnly": False})
                assert {r["id"] for r in repaired["data"]} == set(expected)
                warm = traverse()
                assert {i for page in warm for i in page["ids"]} == set(expected)
                print(json.dumps({"n": count, "limit": limit, "direction": direction,
                                  "tiedMtime": tied, "beforeCopy": before_copy,
                                  "afterCopy": after_copy,
                                  "seed": {"ids": [r["id"] for r in seed["data"]],
                                           "nextCursor": seed["nextCursor"]},
                                  "partialIndexIds": indexed_ids,
                                  "postSeed": cold, "warm": warm}))
            finally:
                p.stdin.close()
                try:
                    p.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    p.terminate()
                    p.wait(timeout=10)
                p.stdout.close()


for n, limit, tied in ((5, 2, False), (5, 1, True)):
    for direction in ("asc", "desc"):
        case(n, limit, direction, tied)
