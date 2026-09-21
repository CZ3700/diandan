import { readFile, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
const root = process.cwd();
const cwd = path.join(root, 'packages/persistence-postgres');
const evidence = path.join(root, 'output/checks/p5-02-order-operations');
const pkg = JSON.parse(await readFile(path.join(cwd,'package.json'),'utf8'));
const commands = pkg.scripts['test:postgres'].split(' && ');
const suffix = commands.slice(commands.indexOf('node ./scripts/postgres-catalog-directory.mjs'));
if (suffix.length !== 20) throw new Error('Unexpected PostgreSQL suffix');
const log = createWriteStream(path.join(evidence,'postgres-regression-suffix.log'));
const results = [];
const startedAt = new Date().toISOString();
for (const [index, command] of suffix.entries()) {
  const message = `${index+1}/${suffix.length} ${command}\n`;
  process.stdout.write(message); log.write(message);
  const start = performance.now();
  const child = spawn(process.execPath, command.split(' ').slice(1), {cwd, stdio:['ignore','pipe','pipe']});
  child.stdout.on('data', bytes => { process.stdout.write(bytes); log.write(bytes); });
  child.stderr.on('data', bytes => { process.stderr.write(bytes); log.write(bytes); });
  const code = await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve)});
  results.push({command,exitCode:code,elapsedMs:Math.round(performance.now()-start)});
  await writeFile(path.join(evidence,'postgres-regression-suffix-result.json'),JSON.stringify({startedAt,updatedAt:new Date().toISOString(),status:code===0?(results.length===suffix.length?'PASS':'RUNNING'):'FAIL',results},null,2)+'\n');
  if(code!==0) {process.exitCode=1;break;}
}
log.end();
