import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { probeLocalApplications } from "./local-experience-health.mjs";
test("a stopped worker makes the persisted environment unhealthy while other apps still run", async (t) => {
  const live = createServer((_request, response) =>
      response.writeHead(200).end(),
    ),
    failed = createServer((_request, response) =>
      response.writeHead(503).end(),
    );
  await Promise.all(
    [live, failed].map(
      (server) =>
        new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)),
    ),
  );
  t.after(() =>
    Promise.all(
      [live, failed].map(
        (server) => new Promise((resolve) => server.close(resolve)),
      ),
    ),
  );
  const port = live.address().port;
  const result = await probeLocalApplications({
    ports: {
      api: port,
      worker: failed.address().port,
      storefrontBackend: port,
      adminBackend: port,
    },
  });
  assert.equal(result.ready, false);
  assert.deepEqual(result.services, {
    api: true,
    worker: false,
    storefront: true,
    admin: true,
  });
});
