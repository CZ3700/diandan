import { Buffer } from "node:buffer";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  rumObservationSchema,
  rumReportSchema,
  aggregateRum,
  RUM_MAX_RECORDS,
} from "../apps/storefront/scripts/rum-runtime.mjs";

export async function readRumLogs(files) {
  if (!Array.isArray(files) || files.length < 1 || files.length > 32)
    throw new Error("Invalid RUM input files");
  const records = [];
  let totalBytes = 0;
  function accept(line) {
    if (line.length > 65_536) throw new Error("RUM log line limit exceeded");
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      if (line.includes("performance.web_vital"))
        throw new Error("Invalid RUM observation");
      return;
    }
    if (value?.event !== "performance.web_vital") return;
    const result = rumObservationSchema.safeParse(value);
    if (!result.success) throw new Error("Invalid RUM observation");
    if (records.length >= RUM_MAX_RECORDS)
      throw new Error("RUM record limit exceeded");
    records.push(result.data);
  }
  for (const file of files) {
    let pending = "";
    for await (const chunk of createReadStream(file, {
      encoding: "utf8",
      highWaterMark: 16_384,
    })) {
      totalBytes += Buffer.byteLength(chunk);
      if (totalBytes > 100 * 1024 * 1024)
        throw new Error("RUM log byte limit exceeded");
      pending += chunk;
      let newline;
      while ((newline = pending.indexOf("\n")) !== -1) {
        accept(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
      }
      if (pending.length > 65_536)
        throw new Error("RUM log line limit exceeded");
    }
    if (pending) accept(pending);
  }
  return records;
}

export function renderRumDashboard(candidate) {
  const report = rumReportSchema.parse(candidate);
  const data = JSON.stringify(report)
    .replaceAll("<", "\\u003c")
    .replaceAll("&", "\\u0026");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>Storefront performance observations</title><style>
body{font:16px/1.6 system-ui,sans-serif;margin:0;background:#111318;color:#f5f3ef}main{max-width:1200px;margin:auto;padding:40px 24px}h1{font-size:32px;margin:0 0 8px}p{color:#c3c7ce}label{display:inline-grid;gap:4px;margin:0 16px 20px 0}select{font:inherit;color:inherit;background:#242830;padding:8px;border:1px solid #717987;border-radius:4px}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}td,th{text-align:left;padding:10px;border-bottom:1px solid #40444d}th{color:#d8b26e}.scroll{overflow:auto}.notice{padding:16px;border-left:3px solid #d8b26e}caption{text-align:left;padding:16px 0}
</style><main><h1>Storefront performance observations</h1><p>Anonymous document metrics · LCP / INP / CLS</p><p id="window"></p><p class="notice">Local and automated observations verify instrumentation only. Browser automation is self-reported. A field label does not prove real users or release acceptance. INSUFFICIENT means more samples are required; missing INP is never filled with zero. Standard hard-document metrics retain the initial route; soft navigations are not measured separately. BFCache restores after a soft-route change are excluded.</p><div id="filters"></div><div class="scroll"><table><caption id="summary">No observations — INSUFFICIENT</caption><thead><tr><th>Source</th><th>Locale</th><th>Page</th><th>Viewport</th><th>Metric</th><th>Samples</th><th>p75</th><th>Budget &lt;</th><th>Assessment</th></tr></thead><tbody id="rows"></tbody></table></div></main><script type="application/json" id="data">${data}</script><script>
const report=JSON.parse(document.getElementById('data').textContent);
document.getElementById('window').textContent=report.windowStart+' → '+report.windowEnd+' · receipt window · minimum '+report.minimumSamples+' samples per metric · nearest-rank p75';
const baseGroups=new Map();
for(const row of report.rows){const key=JSON.stringify([row.mode,row.context,row.samplePermille]);if(!baseGroups.has(key))baseGroups.set(key,[]);baseGroups.get(key).push(row);}
const rows=[];for(const group of baseGroups.values()){for(const metric of ['LCP','INP','CLS']){rows.push(group.find(row=>row.metric===metric)||{...group[0],metric,count:0,p75:null,budgetExclusive:{LCP:2500,INP:200,CLS:0.1}[metric],assessment:'INSUFFICIENT'});}}
const controls={};for(const field of ['mode','locale','page','viewport']){const label=document.createElement('label');label.textContent=field;const select=document.createElement('select');for(const value of ['all',...new Set(rows.map(row=>field==='mode'?row.mode:row.context[field]))]){const option=document.createElement('option');option.value=value;option.textContent=value;select.append(option);}label.append(select);document.getElementById('filters').append(label);controls[field]=select;select.addEventListener('change',render);}
function render(){const visible=rows.filter(row=>Object.entries(controls).every(([field,control])=>control.value==='all'||control.value===(field==='mode'?row.mode:row.context[field])));const tbody=document.getElementById('rows');tbody.replaceChildren();for(const row of visible){const tr=document.createElement('tr');const unit=row.metric==='CLS'?'':' ms';for(const value of [row.mode+' / '+row.context.automation+' / '+row.samplePermille+'‰',row.context.locale,row.context.page,row.context.viewport,row.metric,row.count,row.p75===null?'—':Number(row.p75.toFixed(4))+unit,row.budgetExclusive+unit,row.assessment]){const td=document.createElement('td');td.textContent=String(value);tr.append(td);}tbody.append(tr);}document.getElementById('summary').textContent=visible.length?visible.length+' metric groups · '+report.uniqueMeasurements+' distinct observations in this window':'No observations — INSUFFICIENT';}render();
</script></html>`;
}

async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: "string", multiple: true },
      output: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      "minimum-samples": { type: "string", default: "100" },
    },
  });
  if (
    !values.input?.length ||
    !values.output ||
    !values.from ||
    !values.to ||
    !/^[1-9][0-9]*$/u.test(values["minimum-samples"])
  )
    throw new Error(
      "Provide --input --output --from --to and positive --minimum-samples",
    );
  const report = aggregateRum(await readRumLogs(values.input), {
    windowStart: values.from,
    windowEnd: values.to,
    minimumSamples: Number(values["minimum-samples"]),
  });
  const output = path.resolve(values.output);
  await mkdir(output, { recursive: true });
  await writeFile(
    path.join(output, "rum-report.json"),
    JSON.stringify(report, null, 2) + "\n",
    { flag: "wx" },
  );
  await writeFile(
    path.join(output, "rum-dashboard.html"),
    renderRumDashboard(report),
    { flag: "wx" },
  );
  console.log(
    JSON.stringify({
      schemaVersion: 1,
      uniqueMeasurements: report.uniqueMeasurements,
      groups: report.rows.length,
      fieldAcceptance: false,
    }),
  );
}
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  main().catch(() => {
    console.error(
      "RUM report failed; check input validity, bounds and output ownership.",
    );
    process.exitCode = 1;
  });
}
