import "server-only";
import {
  resolveRumConfig,
  resolveServerRuntimeConfig,
} from "@fan-support/config/server";
import {
  RUM_MAX_BODY_BYTES,
  rumIntakeSchema,
} from "@fan-support/contracts/rum";
import { createRumSink, type RumSink } from "@fan-support/observability/rum";
import { matchesConfiguredRequestOrigin } from "./request-origin";

const response = (status: number) =>
  new Response(null, {
    status,
    headers: {
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow",
    },
  });
class BodyLimitError extends Error {}
async function readBody(request: Request): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (
    length !== null &&
    (!/^\d+$/u.test(length) || Number(length) > RUM_MAX_BODY_BYTES)
  )
    throw new BodyLimitError();
  if (!request.body) throw new Error();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        expired = true;
        reject(new Error("Body timeout"));
        void reader.cancel().catch(() => {});
      }, 2000);
    });
    while (true) {
      const part = await Promise.race([reader.read(), timeout]);
      if (expired) throw new Error("Body timeout");
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > RUM_MAX_BODY_BYTES) throw new BodyLimitError();
      if (part.value.byteLength > 0) chunks.push(part.value);
    }
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(buffer),
    ) as unknown;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function createRumIntake(
  options: Readonly<{
    environment: Readonly<Record<string, string | undefined>>;
    sink: RumSink;
    now?: () => Date;
    capacityPerMinute?: number;
  }>,
): (request: Request) => Promise<Response> {
  const now = options.now ?? (() => new Date());
  const capacity = options.capacityPerMinute ?? 600;
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 600)
    throw new Error("Invalid RUM admission limit");
  let minute = -1;
  let accepted = 0;
  let active = 0;
  return async (request) => {
    try {
      const config = resolveRumConfig({ environment: options.environment });
      if (config.mode === "disabled" || config.samplePermille === 0)
        return response(404);
      const { siteOrigin } = resolveServerRuntimeConfig({
        environment: options.environment,
      });
      if (request.method !== "POST") return response(405);
      if (
        !matchesConfiguredRequestOrigin(request, siteOrigin) ||
        request.headers.get("origin") !== siteOrigin ||
        request.headers.get("sec-fetch-site") !== "same-origin"
      )
        return response(403);
      if (new URL(request.url).search !== "") return response(400);
      if (
        !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(
          request.headers.get("content-type") ?? "",
        )
      )
        return response(415);
      const receivedAt = now();
      const currentMinute = Math.floor(receivedAt.getTime() / 60_000);
      if (currentMinute !== minute) {
        minute = currentMinute;
        accepted = 0;
      }
      if (accepted >= capacity || active >= 16) return response(429);
      accepted++;
      active++;
      let releaseOnReturn = true;
      try {
        let body: unknown;
        try {
          body = await readBody(request);
        } catch (error) {
          return response(error instanceof BodyLimitError ? 413 : 400);
        }
        const parsed = rumIntakeSchema.safeParse(body);
        if (!parsed.success) return response(400);
        const observation = {
          schemaVersion: 1 as const,
          event: "performance.web_vital" as const,
          mode: config.mode,
          samplePermille: config.samplePermille,
          receivedAt: receivedAt.toISOString(),
          measurement: parsed.data,
        };
        // Timed-out writes retain their slot until actually settled; never retry them here.
        releaseOnReturn = false;
        const pending = Promise.resolve()
          .then(() => options.sink.record(observation))
          .finally(() => {
            active--;
          });
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            pending,
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error("Sink timeout")), 2000);
            }),
          ]);
          return response(204);
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
      } finally {
        if (releaseOnReturn) active--;
      }
    } catch {
      return response(503);
    }
  };
}

export const handleRumIntake = createRumIntake({
  environment: process.env,
  sink: createRumSink(
    (line) =>
      new Promise<void>((resolve, reject) => {
        process.stdout.write(line, (error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  ),
});
