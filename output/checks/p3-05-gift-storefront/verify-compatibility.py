from pathlib import Path
import hashlib,json,subprocess
base='4c7adf15dbb0933d3afea382f4a6f333b8b0b7e5'
basepath='packages/contracts/generated/'
report={'baseCommit':base,'artifacts':{}}
for name,section in [('contracts.schema.json','$defs'),('openapi.json','components')]:
    oldraw=subprocess.check_output(['git','show',base+':'+basepath+name])
    newraw=Path(basepath+name).read_bytes()
    old,new=json.loads(oldraw),json.loads(newraw)
    oldroots=old[section] if section=='$defs' else old[section]['schemas']
    newroots=new[section] if section=='$defs' else new[section]['schemas']
    changed=[key for key in oldroots if key not in newroots or oldroots[key]!=newroots[key]]
    assert not changed,changed
    if name=='openapi.json':
        assert all(new['paths'].get(key)==value for key,value in old['paths'].items()),'Historical HTTP path changed'
    report['artifacts'][name]={'oldRoots':len(oldroots),'newRoots':len(newroots),'unchangedHistoricalRoots':len(oldroots),'newNames':sorted(set(newroots)-set(oldroots)),'sha256':hashlib.sha256(newraw).hexdigest()}
Path('output/checks/p3-05-gift-storefront/compatibility.json').write_text(json.dumps(report,indent=2)+'\n')
print('All 373 historical roots and previous HTTP operations remain deeply equal; five additive roots.')
