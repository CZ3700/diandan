"""Verify retained outcomes and map all original check steps without claiming a single green run."""
import datetime
import hashlib
import json
import subprocess
from pathlib import Path

base = Path(__file__).resolve().parent
root = Path.cwd()
package = json.loads((root / 'package.json').read_text())
prior = json.loads(subprocess.check_output(['git', 'show', 'f1f702fcf5ab597bd8bd4a0edb549e2ae953469a:package.json']))
assert package['scripts']['check'] == prior['scripts']['check']
checks = package['scripts']['check'].split(' && ')
postgres = package['scripts']['test:postgres'].split(' && ')
pg_node = 'corepack pnpm test:postgres'
publication = 'corepack pnpm --filter @fan-support/api test:postgres:publication-runtime'
commands = checks[:checks.index(pg_node)] + postgres + checks[checks.index(pg_node) + 1:]

def report(name):
    data = json.loads((base / (name + '.json')).read_text())
    assert hashlib.sha256((base / (name + '.log')).read_bytes()).hexdigest() == data['logSha256'], name
    return data

full = report('check-full-2')
remaining = report('check-remainder-1')
quality = report('check-quality-final-2')
auth = report('publication-auth-diagnostic-actual')
assert full['code'] == 1 and auth['exitCode'] == 0
assert quality['code'] == 0 and quality['completedCommands'] == 7
assert len(quality['results']) == len(quality['commands'])
coverage = {}
for command in checks[:checks.index(pg_node)] + postgres[:postgres.index(publication)]:
    coverage[command] = {'command': command, 'status': 'PASS', 'evidence': 'check-full-2.json/log', 'basis': 'Unmodified sequential && chain reached the later publication-runtime failure; preceding commands necessarily returned 0'}
coverage[publication] = {'command': publication, 'status': 'PASS_COMBINED_BUILD_AND_SCRIPT', 'evidence': ['check-full-2.log', 'publication-auth-diagnostic-actual.json', 'publication-auth-review.md'], 'basis': 'Original same-source prerequisite build passed 25/25; unchanged actual HTTP child later exited 0 with 12826 assertions/1462 requests. Parent CLI preload did not reach the child; no authorization diagnosis claimed.'}
for name, data in [('check-remainder-1', remaining), ('check-quality-final-2', quality)]:
    for result in data['results']:
        if result['code'] == 0:
            coverage[result['command']] = {**result, 'status': 'PASS', 'evidence': name + '.json/log'}
assert set(commands) == set(coverage), sorted(set(commands) - set(coverage))
source = json.loads((base / 'source-final.json').read_text())
summary = {
    'schemaVersion': 1,
    'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'status': 'PASS_LOCAL_TEST_CHECKPOINT_WITH_RETAINED_INTERMITTENT_FAILURES',
    'singleFullCheckPassed': False,
    'originalRootCheckUnchanged': True,
    'source': {'count': source['count'], 'sha256': source['sha256']},
    'originalStepCount': len(commands),
    'coverage': [coverage[c] for c in commands],
    'sourceEvolution': [
        {'sha256': '5d43c607c9ca945792c88cea1f697116946df6e5ce986de3c6ee182e1918c5ed', 'scope': 'Final 31-case browser matrix; 1979 inputs'},
        {'sha256': 'aa99ed9495f50a24d28ffc4cc2cccad59d45d6ff10b413a6998bbc84ef99c2c1', 'delta': 'One TEST seed file reuses canonical copy instead of redundant locale literals. Original contract gate and real config/payment HTTP revalidated; not a new browser text capture.'},
        {'sha256': source['sha256'], 'delta': 'Remove unused private PG factory from public barrel and add negative export test. No business implementation/SQL/UI changes; public index build bytes do change. Full final seven quality commands revalidate all consumers.'},
    ],
    'retainedFailures': ['check-full-1.json', 'check-full-2.json', 'check-resume-1.json', 'check-resume-2.json', 'check-remainder-1.json', 'check-quality-final-1.json'],
    'limits': ['Earlier publication authorization/CLAIM_WINDOW causes remain unresolved; unchanged original HTTP child later passed', 'Existing contract determinism test timed out at 5169ms against 5000ms; unchanged test and timeout passed on repeat', 'Local independent TEST PSP only; no approved actual PSP sandbox or live charge', 'P4-04 remains IN_PROGRESS; P4-05 remains PENDING; no financial finalization or deployment'],
}
(base / 'gate-coverage.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps({k: summary[k] for k in ['status', 'singleFullCheckPassed', 'originalStepCount', 'source']}))
