const revalidate = "public, max-age=0, s-maxage=0, must-revalidate";

/** Internal HTTP documentation only; no business schema or artifact root. */
export function publicRevalidationHeaders(status: 200 | 304 | "FAILURE") {
  const description =
    status === "FAILURE"
      ? "Failures are never stored. Cookie or Authorization requests use private, no-store."
      : "Every request rechecks current PostgreSQL proof before a conditional response. Cookie or Authorization requests always return a private, no-store response without ETag or 304.";
  return {
    "Cache-Control": {
      description,
      schema:
        status === 304
          ? { type: "string", const: revalidate }
          : {
              type: "string",
              enum: [
                status === 200 ? revalidate : "no-store",
                "private, no-store",
              ],
            },
    },
    ...(status === "FAILURE"
      ? {}
      : {
          ETag: {
            description:
              "Anonymous weak validator bound to the canonical resource/query and the entire freshly validated representation; absent for credentialed requests.",
            schema: { type: "string", pattern: '^W/"[a-f0-9]{64}"$' },
          },
        }),
  };
}
export function publicRevalidationParameter() {
  return {
    name: "If-None-Match",
    in: "header",
    required: false,
    description:
      "Optional conditional validator. Matching is evaluated only after a fresh successful read; ignored for requests carrying Cookie or Authorization.",
    schema: { type: "string" },
  };
}
export function publicNotModifiedResponse() {
  return {
    description:
      "Unchanged anonymous representation after fresh current-state and publication validation; no response body.",
    headers: publicRevalidationHeaders(304),
  };
}
