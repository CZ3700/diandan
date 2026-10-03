import { expect, test, vi } from "vitest";
import { orderTestId, orderTestToken } from "./order-test-support";
vi.mock("server-only", () => ({}));
const load = () => import("./order-proof-proxy").catch(() => null);
const siteOrigin = "https://shop.example.invalid";
const internalApiOrigin = "http://localhost:3002";
const proofId = "10000000-0000-4000-8000-0000000000f1";
const path = `/api/storefront/orders/${orderTestId}/delivery-proofs/${proofId}/thumbnail`;
const webp = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);
function req(url = path, headers: Record<string, string> = {}, method = "GET") {
  return new Request(siteOrigin + url, {
    method,
    headers: {
      "sec-fetch-site": "same-origin",
      cookie: `unrelated=private; __Host-fan-order=${orderTestToken}; __Host-fan-cart=${orderTestToken}`,
      ...headers,
    },
  });
}
function image(
  bytes: Uint8Array<ArrayBuffer> = webp,
  headers: Record<string, string> = {},
  status = 200,
) {
  return new Response(bytes, {
    status,
    headers: {
      "content-type": "image/webp",
      "content-length": String(bytes.byteLength),
      "cache-control": "private, no-store",
      ...headers,
    },
  });
}
async function run(request: Request, fetcher: typeof fetch) {
  const mod = await load();
  expect(mod?.proxyOrderProofRequest).toBeTypeOf("function");
  return mod!.proxyOrderProofRequest(request, {
    siteOrigin,
    internalApiOrigin,
    fetcher,
  });
}

test("relays one private photo with only the order cookie and inert image headers", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => image());
  const response = await run(req(), fetcher);
  expect(response.status).toBe(200);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(webp);
  expect(Object.fromEntries(response.headers)).toMatchObject({
    "content-type": "image/webp",
    "content-length": String(webp.byteLength),
    "cache-control": "private, no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "cross-origin-resource-policy": "same-origin",
  });
  expect(response.headers.get("content-security-policy")).toContain("sandbox");
  const [url, init] = fetcher.mock.calls[0]!;
  expect(String(url)).toBe(
    `${internalApiOrigin}/api/v1/orders/${orderTestId}/delivery-proofs/${proofId}/thumbnail`,
  );
  expect(init).toMatchObject({
    method: "GET",
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
  });
  expect(init!.headers).toEqual({
    origin: siteOrigin,
    cookie: `__Host-fan-order=${orderTestToken}`,
  });
});

test("photo reads relay the edge forwarded chain so the API rate-limits each fan separately", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => image());
  const response = await run(
    req(path, { "x-forwarded-for": "192.0.2.1, 203.0.113.7" }),
    fetcher,
  );
  expect(response.status).toBe(200);
  expect(fetcher.mock.calls[0]![1]!.headers).toEqual({
    origin: siteOrigin,
    cookie: `__Host-fan-order=${orderTestToken}`,
    "x-forwarded-for": "192.0.2.1, 203.0.113.7",
  });
});

test("malformed, cross-site or credential-free requests never reach the API", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => image());
  for (const [request, status] of [
    [req(path.replace("thumbnail", "original")), 400],
    [req(`${path}?width=10`), 400],
    [req(path.replace(proofId, "not-a-proof")), 400],
    [req(path, { "sec-fetch-site": "cross-site" }), 403],
    [req(path, { origin: "https://evil.example.invalid" }), 403],
    [req(path, { cookie: "unrelated=private" }), 401],
    [
      req(path, {
        cookie: `__Host-fan-order=${orderTestToken}; __Host-fan-order=${orderTestToken}`,
      }),
      401,
    ],
    [req(path, {}, "POST"), 405],
  ] as const) {
    const response = await run(request, fetcher);
    expect(response.status, request.url).toBe(status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  }
  expect(fetcher).not.toHaveBeenCalled();
});

test("only a bounded, private WebP upstream response is relayed", async () => {
  const cases: [Response, number][] = [
    [image(webp, { "content-type": "image/png" }), 503],
    [image(webp, { "cache-control": "public, max-age=60" }), 503],
    [image(webp, { "content-length": String(webp.byteLength + 1) }), 503],
    [image(new Uint8Array(512 * 1024 + 1)), 503],
    [Response.json({ outcome: "FAILURE" }, { status: 401 }), 401],
    [Response.json({ outcome: "FAILURE" }, { status: 404 }), 401],
    [
      Response.json(
        { outcome: "FAILURE" },
        { status: 429, headers: { "retry-after": "12" } },
      ),
      429,
    ],
    [Response.json({ outcome: "FAILURE" }, { status: 500 }), 503],
  ];
  for (const [upstream, status] of cases) {
    const response = await run(req(), async () => upstream);
    expect(response.status).toBe(status);
    expect(response.headers.get("content-type")).toMatch(/^application\/json/u);
    if (status === 429) expect(response.headers.get("retry-after")).toBe("12");
  }
});
