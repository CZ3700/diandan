import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import { once } from "node:events";
import { bindOperationsTranslations } from "./storefront-operations-uat-model.mjs";
import {
  operationsPage,
  operationsStyle,
  operationsClient,
} from "./storefront-operations-uat-page.mjs";

const headers = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};
async function readJson(request, limit) {
  if (request.headers["content-type"] !== "application/json")
    throw new Error("INVALID_BODY");
  if (Number(request.headers["content-length"] ?? 0) > limit)
    throw new Error("INVALID_BODY");
  let size = 0;
  const chunks = [];
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) throw new Error("INVALID_BODY");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function send(response, status, value, type = "application/json") {
  response.writeHead(status, {
    ...headers,
    "content-type": `${type}; charset=utf-8`,
  });
  response.end(type === "application/json" ? JSON.stringify(value) : value);
}

/** Loopback-only human control surface. Contains no administrative API write client. */
export async function startOperationsControl({
  recorder,
  materials,
  persist,
  focus,
}) {
  let origin;
  let writes = Promise.resolve();
  function save() {
    const snapshot = recorder.snapshot();
    writes = writes.then(() => persist(snapshot));
    return writes;
  }
  const server = createServer(async (request, response) => {
    try {
      if (
        request.headers.host !== new globalThis.URL(origin).host ||
        !request.url?.startsWith("/") ||
        request.url.startsWith("//")
      )
        return send(response, 403, { code: "FORBIDDEN" });
      const url = new globalThis.URL(request.url, origin);
      if (url.search || url.hash)
        return send(response, 400, { code: "INVALID_QUERY" });
      if (request.method === "GET") {
        switch (url.pathname) {
          case "/":
            return send(response, 200, operationsPage, "text/html");
          case "/client.js":
            return send(response, 200, operationsClient, "text/javascript");
          case "/style.css":
            return send(response, 200, operationsStyle, "text/css");
          case "/materials.json":
            return send(response, 200, materials);
          case "/state":
            return send(response, 200, recorder.snapshot());
          default:
            return send(response, 404, { code: "NOT_FOUND" });
        }
      }
      if (request.method !== "POST")
        return send(response, 405, { code: "METHOD_NOT_ALLOWED" });
      if (request.headers.origin !== origin)
        return send(response, 403, { code: "FORBIDDEN" });
      if (!["/timer", "/bind", "/focus"].includes(url.pathname))
        return send(response, 404, { code: "NOT_FOUND" });
      const input = await readJson(
        request,
        url.pathname === "/bind" ? 16 * 1024 * 1024 : 1024,
      );
      if (url.pathname === "/timer") {
        const state = recorder.command(input);
        await save();
        return send(response, 200, state);
      }
      if (url.pathname === "/focus") {
        if (
          Object.keys(input ?? {}).length !== 1 ||
          !["editor", "reviewer", "manager"].includes(input.role)
        )
          throw new Error("INVALID_COMMAND");
        await focus(input.role);
        return send(response, 200, { outcome: "OPENED_EXISTING_WINDOW" });
      }
      if (
        Object.keys(input ?? {}).length !== 2 ||
        !Object.hasOwn(input, "kind") ||
        !Object.hasOwn(input, "packet")
      )
        throw new Error("INVALID_COMMAND");
      const bound = bindOperationsTranslations(input.packet, input.kind);
      response.setHeader(
        "content-disposition",
        'attachment; filename="uat-translations.json"',
      );
      return send(response, 200, bound);
    } catch {
      // Never echo imported content, session material or arbitrary exception messages.
      return send(response, 400, {
        code: "REQUEST_NOT_COMPLETED",
        hint: "Check the operation card and current English export; no automatic acceptance was recorded.",
      });
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    async record(event) {
      recorder.record(event);
      await save();
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await writes;
    },
  };
}
