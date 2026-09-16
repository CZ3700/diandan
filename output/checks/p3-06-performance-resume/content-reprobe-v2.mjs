import { writeFile } from "node:fs/promises";
import { storefrontHomepageResponseSchema } from "../../../packages/contracts/dist/index.js";
const records = [];
for (let attempt = 1; attempt <= 20; attempt++) {
  for (const [layer, origin] of [
    ["api", "http://127.0.0.1:57471"],
    ["gateway", "http://127.0.0.1:58507"],
    ["html", "http://localhost:57469"],
  ]) {
    const started = globalThis.performance.now();
    const record = { attempt, layer, startedAt: new Date().toISOString() };
    try {
      const response = await globalThis.fetch(
        origin +
          (layer === "html"
            ? "/zh-CN"
            : "/api/v1/storefront-homepage?locale=zh-CN"),
        { signal: globalThis.AbortSignal.timeout(10000), redirect: "error" },
      );
      record.status = response.status;
      if (layer === "html") {
        const html = await response.text();
        record.heroPresent = html.includes('id="hero-title"');
        record.stateElementPresent = html.includes(
          '<section class="storefront-state"',
        );
      } else {
        const body = await response.json();
        const parsed = storefrontHomepageResponseSchema.safeParse(body);
        record.schemaValid = parsed.success;
        record.outcome = body.outcome;
        record.code = body.code ?? null;
        record.issues = parsed.success
          ? []
          : parsed.error.issues.map(({ code, path }) => ({ code, path }));
      }
    } catch (error) {
      record.error = error.name;
    }
    record.elapsedMs = Math.round(globalThis.performance.now() - started);
    records.push(record);
  }
}
const passed = records.every(
  (r) =>
    r.status === 200 &&
    (r.layer === "html"
      ? r.heroPresent && !r.stateElementPresent
      : r.schemaValid && r.outcome === "SUCCESS"),
);
await writeFile(
  new globalThis.URL("./content-reprobe-v2.json", import.meta.url),
  JSON.stringify(
    {
      schemaVersion: 1,
      passed,
      scope:
        "Sequential API/gateway/SSR public fixture diagnosis after the retained invalid Lighthouse navigation. Does not explain the historical failure or replace performance samples.",
      records,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    passed,
    requests: records.length,
    failures: records.filter(
      (r) =>
        r.status !== 200 ||
        (r.layer === "html"
          ? !r.heroPresent || r.stateElementPresent
          : !r.schemaValid || r.outcome !== "SUCCESS"),
    ),
  }),
);
process.exitCode = passed ? 0 : 1;
