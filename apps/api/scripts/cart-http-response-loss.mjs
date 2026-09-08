import { createServer } from "node:http";

/** Owned single-use fault endpoint: commit upstream, then lose the whole downstream response. */
export async function discardCommittedCartResponse({ base, body, headers }) {
  let upstreamStatus = null,
    downstreamHeadersSent = false,
    used = false;
  const server = createServer(async (request, response) => {
    request.resume();
    if (used || request.method !== "POST" || request.url !== "/discard") {
      response.writeHead(404).end();
      return;
    }
    used = true;
    try {
      const upstream = await globalThis.fetch(base + "/api/v1/cart/items", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: globalThis.AbortSignal.timeout(30_000),
      });
      await upstream.arrayBuffer();
      upstreamStatus = upstream.status;
    } catch {
      upstreamStatus = null;
    }
    downstreamHeadersSent = response.headersSent;
    response.destroy();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let clientNetworkFailure = false;
  try {
    await globalThis.fetch(
      `http://127.0.0.1:${server.address().port}/discard`,
      { method: "POST", signal: globalThis.AbortSignal.timeout(35_000) },
    );
  } catch (error) {
    clientNetworkFailure = error instanceof TypeError;
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  return { upstreamStatus, clientNetworkFailure, downstreamHeadersSent };
}
