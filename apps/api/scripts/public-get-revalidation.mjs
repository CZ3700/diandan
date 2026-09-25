/** HTTP-only assertions; every caller has already parsed the current public response schema. */
export function assertPublicGetCaching(response, value, check) {
  const success = response.status === 200 && value.outcome === "SUCCESS";
  check(
    response.headers.get("cache-control") ===
      (success ? "public, max-age=0, s-maxage=0, must-revalidate" : "no-store"),
    "anonymous public GET uses exact zero-TTL revalidation only for validated success",
  );
  check(
    success
      ? /^W\/"[a-f0-9]{64}"$/u.test(response.headers.get("etag") ?? "")
      : response.headers.get("etag") === null,
    "only validated public success receives an ETag",
  );
}

/** Run once per resource family, against the actual API and its current database proofs. */
export async function verifyPublicGetConditional({
  base,
  route,
  response,
  schema,
  check,
}) {
  const headers = { "if-none-match": response.headers.get("etag") };
  const conditional = await globalThis.fetch(base + route, {
    headers,
    redirect: "manual",
    signal: globalThis.AbortSignal.timeout(30_000),
  });
  check(
    conditional.status === 304,
    "unchanged current public projection returns real HTTP 304",
  );
  check((await conditional.text()) === "", "HTTP 304 has no response body");
  check(
    conditional.headers.get("etag") === headers["if-none-match"],
    "HTTP 304 preserves the current scoped ETag",
  );
  check(
    conditional.headers.get("cache-control") ===
      "public, max-age=0, s-maxage=0, must-revalidate",
    "HTTP 304 cannot become a positive-TTL shared response",
  );
  for (const credentials of [
    { cookie: "fixture-public-cache=present" },
    { authorization: "Bearer fixture-public-cache-only" },
  ]) {
    const privateReply = await globalThis.fetch(base + route, {
      headers: { ...headers, ...credentials },
      redirect: "manual",
      signal: globalThis.AbortSignal.timeout(30_000),
    });
    check(
      privateReply.status === 200,
      "credential-bearing conditional public GET re-reads and returns 200",
    );
    check(
      privateReply.headers.get("cache-control") === "private, no-store",
      "credential-bearing public GET stays private and uncacheable",
    );
    check(
      privateReply.headers.get("etag") === null &&
        privateReply.headers.get("set-cookie") === null,
      "credential-bearing public GET neither emits an ETag nor issues a session",
    );
    check(
      schema.parse(await privateReply.json()).outcome === "SUCCESS",
      "credential-bearing public GET retains its validated public DTO",
    );
  }
}
