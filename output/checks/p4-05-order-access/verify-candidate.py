"""Reproducible local source and compatibility evidence. Does not stage or edit source."""
import datetime
import hashlib
import json
import pathlib
import subprocess
import sys

root = pathlib.Path(__file__).resolve().parents[3]
out = pathlib.Path(__file__).resolve().parent
base = 'ab0b1375544b32313cfd4ac1cc184f63975b8e87'
scopes = ['apps', 'packages', 'scripts', 'database', 'provider-fixtures', '.node-version', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json', 'turbo.json', 'vitest.config.ts', 'eslint.config.mjs']
def git(*args):
    return subprocess.check_output(['git', *args], cwd=root)
def digest(data):
    return hashlib.sha256(data).hexdigest()
def save(name, value):
    (out / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
paths = sorted(set(p for p in git('ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', *scopes).decode().split('\0') if p))
files = [{'path': p, 'sha256': digest((root / p).read_bytes())} for p in paths]
sha = digest(json.dumps(files, ensure_ascii=False, separators=(',', ':')).encode())
save(sys.argv[1] if len(sys.argv) > 1 else 'source-final.json', {'schemaVersion': 1, 'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'baseCommit': base, 'scopes': scopes, 'encoding': 'sha256 of compact UTF-8 JSON files array, ensure_ascii=false', 'sha256': sha, 'files': files})
old_contracts = json.loads(git('show', base + ':packages/contracts/generated/contracts.schema.json'))['$defs']
new_contracts = json.loads((root / 'packages/contracts/generated/contracts.schema.json').read_text())['$defs']
old_api = json.loads(git('show', base + ':packages/contracts/generated/openapi.json'))
new_api = json.loads((root / 'packages/contracts/generated/openapi.json').read_text())
changed_roots = [k for k, v in old_contracts.items() if new_contracts.get(k) != v]
changed_paths = [k for k, v in old_api['paths'].items() if new_api['paths'].get(k) != v]
changed_components = [k for k, v in old_api['components']['schemas'].items() if new_api['components']['schemas'].get(k) != v]
old_sql = [p for p in git('ls-tree', '-r', '--name-only', base, '--', 'database/migrations').decode().splitlines() if p.endswith('.sql')]
changed_sql = [p for p in old_sql if git('show', base + ':' + p) != (root / p).read_bytes()]
initial = json.loads((out / 'initial-untracked.json').read_text())['files']
changed_untracked = [row['path'] for row in initial if not (root / row['path']).is_file() or digest((root / row['path']).read_bytes()) != row['sha256']]
report = {'schemaVersion': 1, 'status': 'PASS' if not (changed_roots or changed_paths or changed_components or changed_sql or changed_untracked) else 'FAIL', 'baseCommit': base, 'oldContractRoots': len(old_contracts), 'currentContractRoots': len(new_contracts), 'changedOldRoots': changed_roots, 'oldApiPaths': len(old_api['paths']), 'currentApiPaths': len(new_api['paths']), 'changedOldPaths': changed_paths, 'oldApiComponents': len(old_api['components']['schemas']), 'changedOldComponents': changed_components, 'oldSqlFiles': len(old_sql), 'changedOldSql': changed_sql, 'initialUntrackedFiles': len(initial), 'changedInitialUntracked': changed_untracked, 'sourceFiles': len(files), 'sourceSha256': sha}
save('compatibility-and-protection.json', report)
print(json.dumps({k:v for k,v in report.items() if k not in ['baseCommit']}, ensure_ascii=False))
if report['status'] != 'PASS':
    raise SystemExit(1)
