"""Run an exact command, retain its raw log and record its actual exit outcome."""
import datetime
import hashlib
import json
import pathlib
import subprocess
import sys
import time

directory = pathlib.Path(__file__).resolve().parent
name, *command = sys.argv[1:]
assert name and command and all(c.isalnum() or c in "-_" for c in name)
log = directory / (name + ".log")
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
clock = time.monotonic()
with log.open("wb") as stream:
    result = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=stream, stderr=subprocess.STDOUT)
report = {
    "schemaVersion": 1,
    "command": command,
    "startedAt": started,
    "endedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "durationSeconds": time.monotonic() - clock,
    "code": result.returncode,
    "log": log.name,
    "logSha256": hashlib.sha256(log.read_bytes()).hexdigest(),
}
(directory / (name + ".json")).write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report))
sys.exit(result.returncode)
