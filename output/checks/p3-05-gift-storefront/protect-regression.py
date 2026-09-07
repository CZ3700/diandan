"""Preserve the previous checkpoint's HTTP evidence around a fresh full check."""
from pathlib import Path
import hashlib,json,sys
root=Path('output/checks/p3-05-gift-storefront')
original=Path('output/playwright/p3-04-storefront/http-results.json')
backup=root/'local-backup'/'p3-04-http-results.json'
manifest=root/'regression-preservation.json'
mode=sys.argv[1]
if mode=='backup':
    if backup.exists(): raise RuntimeError('Refuse to overwrite an existing checkpoint backup')
    backup.parent.mkdir(parents=True,exist_ok=True)
    raw=original.read_bytes();backup.write_bytes(raw)
    manifest.write_text(json.dumps({'originalPath':str(original),'originalSha256':hashlib.sha256(raw).hexdigest(),'state':'PRESERVED_BEFORE_CHECK'},indent=2)+'\n')
elif mode=='restore':
    before=json.loads(manifest.read_text());raw=backup.read_bytes()
    assert hashlib.sha256(raw).hexdigest()==before['originalSha256']
    current=original.read_bytes()
    if current!=raw:
        archive=root/'regression'/'p3-04-http-results.json';archive.parent.mkdir(exist_ok=True)
        archive.write_bytes(current)
        before['freshRegressionSha256']=hashlib.sha256(current).hexdigest()
        before['freshRegressionPath']=str(archive)
    original.write_bytes(raw)
    assert hashlib.sha256(original.read_bytes()).hexdigest()==before['originalSha256']
    before['state']='RESTORED_AND_VERIFIED'
    manifest.write_text(json.dumps(before,indent=2)+'\n')
else: raise ValueError('Use backup or restore')
print(mode, 'complete')
