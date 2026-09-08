from pathlib import Path
import datetime, hashlib, json, os, subprocess, time
root = Path.cwd()
out = root / 'output/checks/p4-04-payment-runtime'
preload = out / 'publication-auth-diagnostic.mjs'
source = root / 'apps/api/scripts/publication-runtime-http.mjs'
inputs = [source, root / 'packages/persistence-postgres/src/admin-authorization-repository.ts', preload]
hashes = lambda: {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs}
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
monotonic = time.monotonic()
before = hashes()
command = ['mise', 'exec', 'node@24.20.0', '--', 'node', '--import', str(preload), str(source)]
environment = os.environ.copy()
environment['P404_AUTH_DIAGNOSTIC'] = '1'
environment.pop('PUBLICATION_PURGE_CLOCK_PROBE', None)
with (out / 'publication-auth-diagnostic-actual.log').open('w') as log:
    result = subprocess.run(command, cwd=root, env=environment, stdout=log, stderr=subprocess.STDOUT)
metadata = {'schemaVersion':1,'command':command,'startedAt':started,'endedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'durationSeconds':time.monotonic()-monotonic,'exitCode':result.returncode,'sourceBefore':before,'sourceAfter':hashes(),'log':'publication-auth-diagnostic-actual.log','logSha256':hashlib.sha256((out/'publication-auth-diagnostic-actual.log').read_bytes()).hexdigest(),'scope':'One unchanged actual publication-runtime HTTP script with fixed safe TEST observer only. Additional grant counts are diagnostic_after_query and not original volatile instants. No enabled clock perturbation, modified guard or business write by preload.'}
(out/'publication-auth-diagnostic-actual.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'exitCode':result.returncode,'durationSeconds':metadata['durationSeconds']}))
raise SystemExit(result.returncode)
