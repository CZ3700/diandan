import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const lighthouseRoot = path.dirname(require.resolve('lighthouse/package.json'));
const { LanternLargestContentfulPaint } = await import(pathToFileURL(path.join(lighthouseRoot, 'core/computed/metrics/lantern-largest-contentful-paint.js')).href);
const directory = path.resolve(process.argv[2]);
const read = async name => JSON.parse(await readFile(path.join(directory, name), 'utf8'));
const files = (await readdir(directory)).filter(name => /-mobile-\d+\.json$/.test(name)).sort();
assert.ok(files.length, 'must analyze retained reports');
const results = [];
for (const filename of files) {
  const stem = filename.slice(0, -5);
  const lhr = await read(filename);
  const inputs = await read(`${stem}.lantern-inputs.json`);
  const trace = await read(`${stem}.trace.json`);
  const devtoolsLog = await read(`${stem}.devtoolslog.json`);
  const data = {
    trace, devtoolsLog,
    gatherContext: inputs.GatherContext ?? inputs.gatherContext,
    URL: inputs.URL,
    HostDPR: inputs.HostDPR,
    SourceMaps: [],
    settings: lhr.configSettings,
    simulator: null,
  };
  assert.equal(data.gatherContext.gatherMode, 'navigation');
  const metric = await LanternLargestContentfulPaint.request(data, { computedCache: new Map() });
  const summarize = estimate => ({
    timeInMs: estimate.timeInMs,
    nodes: [...estimate.nodeTimings].map(([node, timings]) => ({
      id: node.id, type: node.type,
      ...(node.type === 'network' ? {
        url: node.request.url, resourceType: node.request.resourceType,
        priority: node.request.priority, transferSize: node.request.transferSize,
        protocol: node.request.protocol,
      } : { eventName: node.event.name, duration: node.event.dur }),
      dependencies: node.getDependencies().map(item => item.id),
      ...timings,
    })).sort((a, b) => b.endTime - a.endTime),
  });
  const original = lhr.audits['largest-contentful-paint'].numericValue;
  const result = {
    file: filename, originalLcpMs: original, recomputedLcpMs: metric.timing,
    differenceMs: metric.timing - original,
    optimistic: summarize(metric.optimisticEstimate),
    pessimistic: summarize(metric.pessimisticEstimate),
    scope: 'Exact locked Lighthouse algorithm over retained raw navigation; SourceMaps unused by default devtools graph; no metric or throttling modification',
  };
  results.push(result);
  console.log(JSON.stringify({file: filename, original, recomputed: metric.timing, lastOptimistic: result.optimistic.nodes.slice(0, 4), lastPessimistic: result.pessimistic.nodes.slice(0, 4)}));
}
await writeFile(path.join(directory, 'lantern-node-analysis.json'), JSON.stringify(results, null, 2) + '\n');
assert.ok(results.every(result => Math.abs(result.differenceMs) < 0.01), 'recomputed metric must match original before interpreting graph');
