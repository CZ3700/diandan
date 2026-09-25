import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createGiftStorefrontFaultGateway } from "./gift-storefront-next.mjs";

// Real HTTP upstream and gateway; no fake fetch, forced socket destruction or timer changes.
test("gateway advertises its own keep-alive lifetime instead of the upstream connection lifetime", async (t) => {
  const defaults = createServer();
  const localTimeoutSeconds = defaults.keepAliveTimeout / 1000;
  const upstream = createServer((_request, response) => {
    response
      .writeHead(200, {
        "content-type": "application/json",
        "x-end-to-end": "retained",
      })
      .end('{"ok":true}');
  });
  upstream.keepAliveTimeout = 72_000;
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        upstream.closeAllConnections();
        upstream.close(resolve);
      }),
  );
  const origin = `http://127.0.0.1:${upstream.address().port}`;
  const direct = await globalThis.fetch(origin);
  await direct.text();
  assert.equal(direct.headers.get("keep-alive"), "timeout=72");
  const gateway = await createGiftStorefrontFaultGateway(origin);
  t.after(() => gateway.close());
  const response = await globalThis.fetch(gateway.origin);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-end-to-end"), "retained");
  assert.equal(await response.text(), '{"ok":true}');
  const advertised = response.headers.get("keep-alive");
  const advertisedSeconds =
    advertised === null
      ? null
      : Number(/(?:^|,)\s*timeout=(\d+)/u.exec(advertised)?.[1]);
  assert.ok(
    advertisedSeconds === null ||
      (Number.isFinite(advertisedSeconds) &&
        advertisedSeconds <= localTimeoutSeconds),
    "gateway must not advertise a 72-second upstream lifetime for its own default five-second idle connection",
  );
});

test("gateway removes Connection-nominated and standard hop headers while retaining end-to-end response fields", async (t) => {
  const upstream = createServer((_request, response) => {
    response.writeHead(200, {
      connection: "keep-alive, X-Fixture-Hop",
      "keep-alive": "timeout=72",
      "x-fixture-hop": "remove-this-hop",
      "proxy-connection": "keep-alive",
      te: "trailers",
      trailer: "x-finished",
      upgrade: "fixture-protocol",
      "content-type": "application/json",
      "cache-control": "public, max-age=0, must-revalidate",
      etag: 'W/"fixture-response"',
      "x-request-id": "52a3f5cf-eb74-462b-9832-5ee86715c33b",
    });
    response.addTrailers({ "x-finished": "yes" });
    response.end('{"ok":true}');
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        upstream.closeAllConnections();
        upstream.close(resolve);
      }),
  );
  const gateway = await createGiftStorefrontFaultGateway(
    `http://127.0.0.1:${upstream.address().port}`,
  );
  t.after(() => gateway.close());
  const response = await globalThis.fetch(gateway.origin);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '{"ok":true}');
  for (const name of [
    "x-fixture-hop",
    "proxy-connection",
    "te",
    "trailer",
    "upgrade",
  ])
    assert.equal(
      response.headers.get(name),
      null,
      `${name} belongs only to the upstream connection`,
    );
  assert.equal(response.headers.get("connection"), "keep-alive");
  assert.equal(response.headers.get("keep-alive"), "timeout=5");
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.equal(
    response.headers.get("cache-control"),
    "public, max-age=0, must-revalidate",
  );
  assert.equal(response.headers.get("etag"), 'W/"fixture-response"');
  assert.equal(
    response.headers.get("x-request-id"),
    "52a3f5cf-eb74-462b-9832-5ee86715c33b",
  );
});

test("gateway keeps upstream 200/503 bytes, injected faults and observer isolation", async (t) => {
  let requests = 0;
  const upstream = createServer((request, response) => {
    requests++;
    const status = request.url === "/failure" ? 503 : 200;
    const body = status === 200 ? '{"ok":true}' : '{"ok":false}';
    response
      .writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
        "content-length": String(body.length),
      })
      .end(body);
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        upstream.closeAllConnections();
        upstream.close(resolve);
      }),
  );
  const events = [];
  const gateway = await createGiftStorefrontFaultGateway(
    `http://127.0.0.1:${upstream.address().port}`,
    {
      observer(event) {
        events.push({
          phase: event.phase,
          status: event.status,
          body: event.bytes?.toString(),
        });
        throw new Error("fixture observer failure");
      },
    },
  );
  t.after(() => gateway.close());
  for (const [route, status, body] of [
    ["/success", 200, '{"ok":true}'],
    ["/failure", 503, '{"ok":false}'],
  ]) {
    const response = await globalThis.fetch(gateway.origin + route);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("content-length"), String(body.length));
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(await response.text(), body);
  }
  gateway.setFailure("/injected");
  const injected = await globalThis.fetch(gateway.origin + "/injected");
  assert.equal(injected.status, 503);
  assert.equal(await injected.text(), "");
  assert.equal(requests, 2);
  assert.deepEqual(events, [
    { phase: "GATEWAY_RESPONSE", status: 200, body: '{"ok":true}' },
    { phase: "GATEWAY_RESPONSE", status: 503, body: '{"ok":false}' },
    { phase: "GATEWAY_FAULT", status: 503, body: undefined },
  ]);
});
