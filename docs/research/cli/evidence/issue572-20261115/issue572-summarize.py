import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).parent
VERSIONS = {
    "0.169.0": {
        "nativeSha256": "ce1945eb440b5481ed1233ebaf32b7056ee7e4e452fa62ffe1cbfb26103cdee0",
        "files": {
            "emptyIndex": "issue572-stable-0169-upstream.txt",
            "partialIndex": "issue572-stable-0169-partial.txt",
        },
    },
    "0.171.0-alpha.5": {
        "nativeSha256": "f9e343c2060e7d22ccc5273ad488a725d3774bba53b5abe8985dbb2c154e484e",
        "files": {
            "emptyIndex": "issue572-alpha5-upstream.txt",
            "partialIndex": "issue572-alpha5-partial.txt",
        },
    },
}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def page_summary(pages, expected, limit):
    ids = [ident for page in pages for ident in page["ids"]]
    return {
        "pages": pages,
        "found": len(set(ids)),
        "returned": len(ids),
        "expected": expected,
        "complete": len(ids) == expected and len(set(ids)) == expected,
        "duplicateIds": len(ids) != len(set(ids)),
        "pageSizeExceeded": any(len(page["ids"]) > limit for page in pages),
        "terminalCursorNull": pages[-1]["nextCursor"] is None,
        "prematureTerminal": pages[-1]["nextCursor"] is None and len(set(ids)) < expected,
    }


result = {
    "issue": 572,
    "platform": "Windows x64",
    "source": "https://github.com/openai/codex/issues/60529#issuecomment-6761957474",
    "releaseSources": {
        "0.169.0": "https://github.com/openai/codex/releases/tag/rust-v0.169.0",
        "0.171.0-alpha.5": "https://github.com/openai/codex/releases/tag/rust-v0.171.0-alpha.5",
    },
    "actualModelTurns": 0,
    "scope": "Synthetic legacy rollouts only; isolated fresh CODEX_HOME for each case; no thread/start or turn/start",
    "scriptExitZeroMeansCompatibilityPass": False,
    "probeSourceSha256": {
        name: sha256((ROOT / name).read_bytes())
        for name in ("issue572-upstream-repro.py", "issue572-partial.py")
    },
    "versions": {},
}

for version, info in VERSIONS.items():
    version_result = {"nativeSha256": info["nativeSha256"], "reportedVersion": f"codex-cli {version}", "runs": {}}
    for index_type, filename in info["files"].items():
        data = (ROOT / filename).read_bytes()
        text = data.decode("utf-16" if data.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8-sig")
        lines = text.splitlines()
        assert lines[0] == f"codex-cli {version}", (version, filename, lines[0])
        cases = [json.loads(line) for line in lines[1:]]
        assert len(cases) == (6 if index_type == "emptyIndex" else 4)
        run = {
            "rawEvidence": {"file": filename, "bytes": len(data), "sha256": sha256(data)},
            "observedScriptExitCode": 0,
            "cases": [],
        }
        for case in cases:
            entry = {
                "rollouts": case["n"],
                "limit": case["limit"],
                "mtime": "tied" if case["tiedMtime"] else "oneSecondApart",
                "direction": case["direction"],
                "initialIndex": "empty",
                "databaseOnlyBeforeAndAfterCopyEmpty": True,
            }
            if index_type == "emptyIndex":
                entry["initialIndexEvidence"] = "asserted by unmodified upstream probe before and after rollout creation"
                entry["cold"] = page_summary(case["cold"], case["n"], case["limit"])
            else:
                assert case["beforeCopy"]["data"] == []
                assert case["afterCopy"]["data"] == []
                entry["initialIndexEvidence"] = "raw database-only responses stored in partial-index output"
                entry["seedPage"] = case["seed"]
                entry["partialIndexIds"] = case["partialIndexIds"]
                entry["partialIndexCount"] = len(case["partialIndexIds"])
                assert 0 < entry["partialIndexCount"] < case["n"]
                entry["postSeed"] = page_summary(case["postSeed"], case["n"], case["limit"])
            entry["afterFullRepair"] = page_summary(case["warm"], case["n"], case["limit"])
            run["cases"].append(entry)
        version_result["runs"][index_type] = run
    result["versions"][version] = version_result

out = ROOT / "issue572-validation-summary.json"
out.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
print(out.name, out.stat().st_size, sha256(out.read_bytes()))
