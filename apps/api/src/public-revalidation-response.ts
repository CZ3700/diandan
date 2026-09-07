import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

function matches(header: string | string[] | undefined, etag: string): boolean {
  if (typeof header !== "string" || header.length > 4096) return false;
  if (header.trim() === "*") return true;
  const pattern = /(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"/gu;
  const tags = header.match(pattern) ?? [];
  return (
    header.replace(pattern, "").replaceAll(",", "").trim() === "" &&
    tags.some((tag) => tag.replace(/^W\//u, "") === etag.replace(/^W\//u, ""))
  );
}

/** Call only after command, current publication and complete response validation. No stale authorization shortcut. */
export function sendRevalidatedPublicJson(
  request: FastifyRequest,
  reply: FastifyReply,
  value: unknown,
  identity: Readonly<{ resource: string; query: unknown }>,
) {
  if (
    request.headers.cookie !== undefined ||
    request.headers.authorization !== undefined
  )
    return reply
      .header("cache-control", "private, no-store")
      .removeHeader("etag")
      .send(value);
  const etag = `W/"${createHash("sha256")
    .update(JSON.stringify({ schemaVersion: 1, identity, value }))
    .digest("hex")}"`;
  void reply
    .header("cache-control", "public, max-age=0, s-maxage=0, must-revalidate")
    .header("etag", etag);
  if (matches(request.headers["if-none-match"], etag))
    return reply.code(304).send();
  return reply.send(value);
}
