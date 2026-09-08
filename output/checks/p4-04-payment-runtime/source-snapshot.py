"""Freeze real implementation inputs and report byte or path drift without edits."""
import datetime
import hashlib
import json
import pathlib
import subprocess
import sys

root = pathlib.Path(subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip())
scope = [
    ".env.example", ".github", ".node-version", ".secretlintrc.json", "apps", "packages",
    "scripts", "provider-fixtures", "infra", "database", "package.json",
    "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json", "turbo.json",
    "vitest.config.ts", "eslint.config.mjs",
]
paths = sorted(set(subprocess.check_output(
    ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", *scope],
    cwd=root,
).decode().strip("\0").split("\0")))
files = [{"path": p, "sha256": hashlib.sha256((root / p).read_bytes()).hexdigest()} for p in paths]
report = {
    "schemaVersion": 1,
    "capturedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "base": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip(),
    "scope": scope,
    "count": len(files),
    "sha256": hashlib.sha256(json.dumps(files, separators=(",", ":")).encode()).hexdigest(),
    "files": files,
}
if len(sys.argv) > 2:
    previous = json.loads(pathlib.Path(sys.argv[2]).read_text())
    before = {f["path"]: f["sha256"] for f in previous["files"]}
    after = {f["path"]: f["sha256"] for f in files}
    report["changed"] = sorted(p for p in before.keys() & after.keys() if before[p] != after[p])
    report["added"] = sorted(after.keys() - before.keys())
    report["removed"] = sorted(before.keys() - after.keys())
pathlib.Path(sys.argv[1]).write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({k: v for k, v in report.items() if k not in ("files", "scope")}))
