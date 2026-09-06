import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import {
  cachePurgePortCommandSchema,
  cachePurgePortResponseSchema,
  SUPPORTED_LOCALES,
} from "@fan-support/contracts";

/** A real loopback HTTP origin and purge provider; memory is its intentionally disposable edge cache. */
export async function createPublicationHttpCache({ base, routes }) {
  const entries = new Map(),
    jobs = new Map(),
    identities = new Map();
  const submissions = [],
    completions = [];
  let mode = "COMPLETE",
    pendingPolls = 1;
  const paths = Object.fromEntries(
    Object.entries(routes).map(([name, route]) => [
      name,
      name === "homepage" ? "/" : route.slice("/api/v1".length),
    ]),
  );
  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    try {
      if (request.method === "POST" && request.url === "/purge") {
        let raw = "";
        for await (const chunk of request) {
          raw += chunk;
          if (raw.length > 64 * 1024) throw new Error("invalid");
        }
        const command = cachePurgePortCommandSchema.parse(JSON.parse(raw));
        let value;
        if (command.operation === "SUBMIT_PURGE") {
          if (mode === "FAIL")
            value = {
              schemaVersion: 1,
              operation: command.operation,
              outcome: "FAILURE",
              error: {
                schemaVersion: 1,
                code: "ACCESS_DENIED",
                recovery: "NONE",
              },
            };
          else {
            let reference = identities.get(command.idempotencyKey);
            if (!reference) {
              reference = randomUUID();
              identities.set(command.idempotencyKey, reference);
              jobs.set(reference, { paths: command.paths, polls: 0 });
              submissions.push({ paths: [...command.paths], reference });
            }
            value = {
              schemaVersion: 1,
              operation: command.operation,
              outcome: "SUCCESS",
              value: {
                purgeReference: reference,
                status: "PENDING",
                submittedAt: new Date().toISOString(),
              },
            };
          }
        } else {
          const job = jobs.get(command.purgeReference);
          if (!job) throw new Error("unknown job");
          job.polls++;
          const complete = mode !== "PENDING" && job.polls > pendingPolls;
          if (complete) {
            for (const target of job.paths)
              for (const key of entries.keys())
                if (
                  target.endsWith("*")
                    ? key.startsWith(target.slice(0, -1))
                    : key === target
                )
                  entries.delete(key);
            completions.push(...job.paths);
          }
          value = {
            schemaVersion: 1,
            operation: command.operation,
            outcome: "SUCCESS",
            value: {
              purgeReference: command.purgeReference,
              status: complete ? "COMPLETED" : "PENDING",
              ...(complete ? { completedAt: new Date().toISOString() } : {}),
            },
          };
        }
        const parsed = cachePurgePortResponseSchema.parse(value);
        response.end(JSON.stringify(parsed));
        return;
      }
      const url = new globalThis.URL(request.url, "http://localhost");
      const locale = url.pathname.split("/")[1];
      const name = Object.keys(paths).find(
        (key) =>
          `/${locale}${paths[key] === "/" ? "" : paths[key]}` === url.pathname,
      );
      if (
        request.method !== "GET" ||
        !SUPPORTED_LOCALES.includes(locale) ||
        !name
      ) {
        response.statusCode = 404;
        response.end("{}");
        return;
      }
      const key = url.pathname;
      if (!entries.has(key)) {
        const upstream = await globalThis.fetch(
          base + routes[name] + `?locale=${locale}`,
          { signal: globalThis.AbortSignal.timeout(10_000) },
        );
        if (upstream.status !== 200) throw new Error("origin unavailable");
        entries.set(key, await upstream.text());
      }
      response.end(entries.get(key));
    } catch {
      response.statusCode = 503;
      response.end('{"outcome":"UNAVAILABLE"}');
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  async function dispatch(command) {
    const response = await globalThis.fetch(origin + "/purge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command),
      signal: globalThis.AbortSignal.timeout(10_000),
    });
    if (response.status !== 200)
      throw new Error("Local purge provider unavailable");
    return cachePurgePortResponseSchema.parse(await response.json());
  }
  return {
    port: { submitPurge: dispatch, getPurgeStatus: dispatch },
    submissions,
    completions,
    configure(value, polls = 1) {
      mode = value;
      pendingPolls = polls;
    },
    path(name, locale) {
      return `/${locale}${paths[name] === "/" ? "" : paths[name]}`;
    },
    async read(name, locale) {
      const response = await globalThis.fetch(origin + this.path(name, locale));
      if (response.status !== 200) throw new Error("Local cache unavailable");
      return response.json();
    },
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
