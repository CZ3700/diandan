"""Run the actual root check and retain both old and fresh protocol evidence."""
from datetime import datetime,timezone
from pathlib import Path
import json,subprocess,sys
base=Path('output/checks/p3-05-gift-storefront')
protect=base/'protect-regression.py'
subprocess.run([sys.executable,str(protect),'backup'],check=True)
started=datetime.now(timezone.utc).isoformat()
result=None
try:
    with (base/'check-full.log').open('w') as log:
        result=subprocess.run(['mise','exec','node@24.20.0','--','corepack','pnpm','check'],stdout=log,stderr=subprocess.STDOUT)
finally:
    subprocess.run([sys.executable,str(protect),'restore'],check=True)
    record={'command':'mise exec node@24.20.0 -- corepack pnpm check','startedAt':started,'finishedAt':datetime.now(timezone.utc).isoformat(),'exitCode':None if result is None else result.returncode,'log':'output/checks/p3-05-gift-storefront/check-full.log','note':'Raw logs remain local; previous P3-04 evidence restored and fresh regression archived.'}
    (base/'check-full-result.json').write_text(json.dumps(record,indent=2)+'\n')
if result is None: raise RuntimeError('Check did not return a result')
print('Full root check exit:',result.returncode)
sys.exit(result.returncode)
