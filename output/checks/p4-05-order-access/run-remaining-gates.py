"""Run exact remaining original check gates without relaxing or skipping a gate."""
from pathlib import Path
import datetime
import json
import shlex
import subprocess

root = Path(__file__).resolve().parents[3]
out = Path(__file__).resolve().parent
scripts = json.loads((root / 'package.json').read_text())['scripts']
steps = []
for command in scripts['check'].split(' && '):
    steps.extend(scripts['test:postgres'].split(' && ') if command == 'corepack pnpm test:postgres' else [command])
first = 'corepack pnpm --filter @fan-support/api test:postgres:order-payment'
start_index = steps.index(first)
results = []
started = datetime.datetime.now(datetime.timezone.utc)
selected = [(index, command) for index, command in enumerate(steps, 1) if command == 'corepack pnpm --filter @fan-support/persistence-postgres test:postgres' or index > start_index]
for index, command in selected:
    step_start = datetime.datetime.now(datetime.timezone.utc)
    logfile = f'remaining-{index:02d}.log'
    args = ['mise', 'exec', 'node@24.20.0', '--', 'corepack', 'pnpm', 'exec', *shlex.split(command)]
    with (out / logfile).open('w') as log:
        run = subprocess.run(args, cwd=root, stdout=log, stderr=subprocess.STDOUT)
    ended = datetime.datetime.now(datetime.timezone.utc)
    result = {'ordinal': index, 'command': command, 'argv': args, 'startedAt': step_start.isoformat(), 'completedAt': ended.isoformat(), 'durationSeconds': round((ended-step_start).total_seconds(), 3), 'exitCode': run.returncode, 'log': logfile}
    results.append(result)
    summary = {'schemaVersion': 1, 'status': 'RUNNING' if run.returncode == 0 and index < len(steps) else ('PASS' if run.returncode == 0 else 'FAIL'), 'singleFullCheckPassed': False, 'sourceManifest': 'source-third.json', 'startedAt': started.isoformat(), 'updatedAt': ended.isoformat(), 'durationSeconds': round((ended-started).total_seconds(), 3), 'steps': results}
    (out / 'remaining-gates-result.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps(result), flush=True)
    if run.returncode:
        raise SystemExit(run.returncode)
