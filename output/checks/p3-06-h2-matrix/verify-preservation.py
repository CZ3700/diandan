"""Verify the frozen source and pre-existing untracked files without mutation."""
import datetime
import hashlib
import json
import pathlib
import subprocess

base = pathlib.Path(__file__).resolve().parent
root = base.parents[2]
results = {}
for name in ("source-before", "initial-untracked"):
    original = json.loads((base / (name + ".json")).read_text())
    mismatches = []
    for entry in original["files"]:
        file = root / entry["path"]
        data = file.read_bytes() if file.is_file() else b""
        if len(data) != entry["bytes"] or hashlib.sha256(data).hexdigest() != entry["sha256"]:
            mismatches.append(entry["path"])
    results[name] = {"files": len(original["files"]), "mismatches": mismatches}

results["recordedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
results["status"] = "PASS" if all(not result["mismatches"] for result in (results["source-before"], results["initial-untracked"])) else "FAIL"
results["commitBeforeCheckpoint"] = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
(base / "preservation-result.json").write_text(json.dumps(results, indent=2) + "\n")
print(json.dumps(results))
raise SystemExit(0 if results["status"] == "PASS" else 1)
