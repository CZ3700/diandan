import json,pathlib,subprocess,sys
out=pathlib.Path(__file__).resolve().parent
parts=json.loads(pathlib.Path("package.json").read_text())["scripts"]["check"].split(" && ")
start=next(i for i,x in enumerate(parts) if x.startswith("prettier --check "))
command=["mise","exec","node@24.20.0","--","corepack","pnpm","exec","sh","-c"," && ".join(parts[start:])]
raise SystemExit(subprocess.run([sys.executable,str(out/"run-check.py"),"quality-tail-2",*command]).returncode)
