import hashlib,json,subprocess,sys
from pathlib import Path
root=Path.cwd()
listed=subprocess.check_output(["git","ls-files","-z","--cached","--others","--exclude-standard"]).decode().split("\0")
roots={"apps","packages","scripts","database","infra","provider-fixtures",".github",".agents"}
configs={".env.example",".node-version",".prettierignore",".secretlintrc.json","eslint.config.mjs","package.json","pnpm-lock.yaml","pnpm-workspace.yaml","tsconfig.base.json","turbo.json","vitest.config.ts"}
paths=sorted({name for name in listed if name and (name.split("/")[0] in roots or name in configs) and not name.endswith("/next-env.d.ts") and (root/name).is_file()})
files=[{"path":name,"sha256":hashlib.sha256((root/name).read_bytes()).hexdigest()} for name in paths]
result={"algorithm":"p3-04-source-manifest-v1","count":len(files),"sha256":hashlib.sha256(json.dumps(files,separators=(",",":"),ensure_ascii=False).encode()).hexdigest(),"files":files}
out=root/"output/checks/p3-04-storefront/implementation-source-final.json"
if "--verify" in sys.argv:
 previous=json.loads(out.read_text())
 assert result==previous,"Implementation inputs changed after freeze"
 print(json.dumps({"verified":True,"count":result["count"],"sha256":result["sha256"]}))
else:
 out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
 print(json.dumps({"frozen":True,"count":result["count"],"sha256":result["sha256"]}))
