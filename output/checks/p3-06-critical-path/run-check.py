"""Run one literal command, preserve its log and exact process result."""
import datetime,json,pathlib,subprocess,sys,time
out=pathlib.Path(__file__).resolve().parent
name=sys.argv[1]
command=sys.argv[2:]
started=datetime.datetime.now(datetime.timezone.utc).isoformat()
began=time.monotonic()
with (out/(name+'.log')).open('w') as log:
    result=subprocess.run(command,stdout=log,stderr=subprocess.STDOUT)
report={'schemaVersion':1,'command':command,'startedAt':started,'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'elapsedSeconds':round(time.monotonic()-began,3),'exitCode':result.returncode}
(out/(name+'-result.json')).write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
raise SystemExit(result.returncode)
