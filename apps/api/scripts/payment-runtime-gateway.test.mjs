import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createPaymentTestTls } from "./payment-runtime-tls.mjs";
import { createPaymentStorefrontTlsGateway } from "./payment-runtime-gateway.mjs";

test("actual TLS gateway preserves configured Host, exact body/status and separate Set-Cookie fields", async () => {
  const tls = await createPaymentTestTls();
  const received = [];
  const payload = '{"transportFixture":"字节"}';
  const cookies = [
    "fixture-one=1; Path=/; Secure; HttpOnly",
    "fixture-two=2; Path=/; Secure; HttpOnly",
  ];
  const upstream = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk.toString();
    received.push({
      body,
      method: request.method,
      host: request.headers.host,
      forwardedHost: request.headers["x-forwarded-host"],
      forwardedProto: request.headers["x-forwarded-proto"],
      authorization: request.headers.authorization,
      csrf: request.headers["x-csrf-token"],
    });
    response
      .writeHead(201, {
        "content-type": "application/json",
        "set-cookie": cookies,
        "cache-control": "private, no-store",
      })
      .end('{"transportTest":true}');
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const gateway = await createPaymentStorefrontTlsGateway(
    tls.certificates["storefront.example.invalid"],
  );
  try {
    gateway.attach(`http://127.0.0.1:${upstream.address().port}`);
    const response = await tls.fetcher(
      gateway.origin + "/api/storefront/cart",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-host": "untrusted.invalid",
          "x-forwarded-proto": "http",
          "x-csrf-token": "transport-test-only",
          authorization: "must-not-forward",
        },
        body: payload,
      },
    );
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { transportTest: true });
    assert.deepEqual(response.headers.getSetCookie(), cookies);
    assert.deepEqual(received, [
      {
        body: payload,
        method: "POST",
        host: new globalThis.URL(gateway.origin).host,
        forwardedHost: new globalThis.URL(gateway.origin).host,
        forwardedProto: "https",
        authorization: undefined,
        csrf: "transport-test-only",
      },
    ]);
    assert.throws(
      () => gateway.attach("http://untrusted.invalid"),
      /Invalid owned Next target/u,
    );
  } finally {
    await gateway.close();
    upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
    await tls.close();
  }
});
