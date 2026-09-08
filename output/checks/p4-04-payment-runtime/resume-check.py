"""Resume the unchanged check at its failed command, retaining every remaining gate."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import time

root = Path.cwd()
directory = Path(__file__).resolve().parent
package = json.loads((root / "package.json").read_text())
checks = package["scripts"]["check"].split(" && ")
postgres = package["scripts"]["test:postgres"].split(" && ")
failed = "corepack pnpm --filter @fan-support/api test:postgres:publication-runtime"
start_command = sys.argv[2] if len(sys.argv) > 2 else failed
if start_command in postgres:
    commands = postgres[postgres.index(start_command):] + checks[checks.index("corepack pnpm test:postgres") + 1:]
else:
    commands = checks[checks.index(start_command):]
baseline = json.loads((directory / (sys.argv[3] if len(sys.argv) > 3 else "source-before-full-2.json")).read_text())
for entry in baseline["files"]:
    assert hashlib.sha256((root / entry["path"]).read_bytes()).hexdigest() == entry["sha256"], entry["path"]
environment = os.environ.copy()
# npm scripts supply the workspace's tool binaries ahead of the inherited PATH.
environment["PATH"] = str(root / "node_modules/.bin") + os.pathsep + environment["PATH"]
report = {
    "schemaVersion": 1,
    "derivation": "Unmodified package.json scripts: specified PostgreSQL command through the complete original check suffix; earlier failed commands remain separate outstanding gates",
    "startCommand": start_command,
    "sourceSha256": baseline["sha256"],
    "commands": commands,
    "results": [],
}
name = sys.argv[1] if len(sys.argv) > 1 else "check-resume-1"
assert name and all(character.isalnum() or character in "-_" for character in name)
log_path = directory / (name + ".log")
report_path = directory / (name + ".json")
assert not log_path.exists() and not report_path.exists()
started = time.monotonic()
code = 0
with log_path.open("wb") as log:
    for command in commands:
        began = datetime.datetime.now(datetime.timezone.utc).isoformat()
        clock = time.monotonic()
        log.write(("\n$ " + command + "\n").encode())
        log.flush()
        result = subprocess.run(shlex.split(command), cwd=root, env=environment, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT)
        code = result.returncode
        outcome = {"command": command, "startedAt": began, "durationSeconds": time.monotonic() - clock, "code": code}
        report["results"].append(outcome)
        report_path.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(outcome), flush=True)
        if code:
            break
report["durationSeconds"] = time.monotonic() - started
report["code"] = code
report["completedCommands"] = len(report["results"])
report["completeRemainingCoverage"] = code == 0 and len(report["results"]) == len(commands)
report["logSha256"] = hashlib.sha256(log_path.read_bytes()).hexdigest()
report_path.write_text(json.dumps(report, indent=2) + "\n")
raise SystemExit(code)
