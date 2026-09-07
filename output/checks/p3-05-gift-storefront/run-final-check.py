"""Retry the complete check after the recorded format failure, retaining evidence."""
from datetime import datetime, timezone
from pathlib import Path
import hashlib, json, subprocess, sys
base = Path('output/checks/p3-05-gift-storefront')
log_path = base / 'check-final.log'
result_path = base / 'check-final-result.json'
if log_path.exists() or result_path.exists():
    raise RuntimeError('Refuse to overwrite an earlier final check attempt')
manifest_path = base / 'regression-preservation.json'
manifest = json.loads(manifest_path.read_text())
original = Path(manifest['originalPath'])
backup = base / 'local-backup' / 'p3-04-http-results.json'
for path in [original, backup]:
    assert hashlib.sha256(path.read_bytes()).hexdigest() == manifest['originalSha256']
first = base / 'regression' / 'p3-04-http-results-first-check.json'
if first.exists():
    raise RuntimeError('Refuse to overwrite the first check regression')
first.write_bytes(Path(manifest['freshRegressionPath']).read_bytes())
manifest['earlierFreshRegressions'] = [{'path': str(first), 'sha256': hashlib.sha256(first.read_bytes()).hexdigest()}]
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
started = datetime.now(timezone.utc).isoformat()
result = None
try:
    with log_path.open('w') as log:
        result = subprocess.run(['mise', 'exec', 'node@24.20.0', '--', 'corepack', 'pnpm', 'check'], stdout=log, stderr=subprocess.STDOUT)
finally:
    subprocess.run([sys.executable, str(base / 'protect-regression.py'), 'restore'], check=True)
    result_path.write_text(json.dumps({'command': 'mise exec node@24.20.0 -- corepack pnpm check', 'startedAt': started, 'finishedAt': datetime.now(timezone.utc).isoformat(), 'exitCode': None if result is None else result.returncode, 'log': str(log_path), 'supersedes': str(base / 'check-full-result.json'), 'note': 'Original failed check and both fresh P3-04 protocol results retained. Immutable prior checkpoint evidence restored.'}, indent=2) + '\n')
if result is None:
    raise RuntimeError('Final check did not return a result')
print('Final complete check exit:', result.returncode)
sys.exit(result.returncode)
