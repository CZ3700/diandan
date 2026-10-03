import Fastify from "fastify";
import { expect, test, vi } from "vitest";
import { registerAdminArtistNotesRoute } from "./admin-artist-notes-route.js";

const origin = "https://admin.example.invalid",
  token = "a".repeat(42) + "A",
  csrf = "b".repeat(42) + "A";
const artistId = "10000000-0000-4000-8000-000000000001",
  noteId = "10000000-0000-4000-8000-000000000002";
const headers = {
  origin,
  cookie: `__Host-fan-admin-session=${token}`,
  "x-csrf-token": csrf,
  "content-type": "application/json",
};
const version = {
  noteId,
  version: 1,
  savedAt: "2026-10-01T02:00:00.000Z",
  savedBy: "Studio owner",
};
const content = { realName: "Minji", contact: "", identity: "", other: "" };
const responses: Record<string, unknown> = {
  CONTEXT: {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "CONTEXT",
    artistId,
    gate: "READY",
    versions: [version],
  },
  READ: {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "NOTE",
    artistId,
    note: version,
    accessId: noteId,
    expiresAt: "2026-10-01T02:05:00.000Z",
    content,
  },
  SAVE: {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "SAVED",
    artistId,
    note: version,
  },
};
function setup() {
  const app = Fastify({ logger: false });
  const execute = vi.fn(
    async (input: { command: { action: string } }): Promise<unknown> =>
      responses[input.command.action],
  );
  registerAdminArtistNotesRoute(app, {
    allowedOrigin: origin,
    useCases: { execute },
  });
  return { app, execute };
}
const bodies = {
  context: { schemaVersion: 1, artistId },
  read: { schemaVersion: 1, artistId, noteId },
  save: { schemaVersion: 1, artistId, noteId, expectedVersion: 0, content },
};

test("each path names its own action and the transport supplies the credentials", async () => {
  const { app, execute } = setup();
  try {
    for (const [path, body] of Object.entries(bodies)) {
      const result = await app.inject({
        method: "POST",
        url: `/api/v1/admin/artist-notes/${path}`,
        headers,
        payload: body,
      });
      expect(result.statusCode).toBe(200);
      expect(result.headers["cache-control"]).toBe("private, no-store");
      expect(result.headers["referrer-policy"]).toBe("no-referrer");
      expect(result.headers["x-robots-tag"]).toBe("noindex, nofollow");
    }
    expect(execute.mock.calls.map(([input]) => input.command.action)).toEqual([
      "CONTEXT",
      "READ",
      "SAVE",
    ]);
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      sessionToken: token,
      csrfToken: csrf,
    });
  } finally {
    await app.close();
  }
});

test("forged authority, unknown fields and a foreign origin never reach the application", async () => {
  const { app, execute } = setup();
  try {
    for (const forged of [
      { ...bodies.context, action: "READ" },
      { ...bodies.context, actorId: artistId },
      { ...bodies.context, sessionToken: token },
      { ...bodies.context, gate: "READY" },
      { ...bodies.read, content },
    ]) {
      const result = await app.inject({
        method: "POST",
        url: `/api/v1/admin/artist-notes/${"noteId" in forged ? "read" : "context"}`,
        headers,
        payload: forged,
      });
      expect(result.statusCode).toBe(400);
    }
    const foreign = await app.inject({
      method: "POST",
      url: "/api/v1/admin/artist-notes/context",
      headers: { ...headers, origin: "https://evil.example.invalid" },
      payload: bodies.context,
    });
    expect(foreign.statusCode).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});

test("a missing second factor is a 403 and a reply for another artist or version is withheld", async () => {
  const { app, execute } = setup();
  try {
    execute.mockResolvedValueOnce({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "SECOND_FACTOR_REQUIRED",
    });
    const gated = await app.inject({
      method: "POST",
      url: "/api/v1/admin/artist-notes/read",
      headers,
      payload: bodies.read,
    });
    expect(gated.statusCode).toBe(403);
    expect(gated.json()).toMatchObject({ code: "SECOND_FACTOR_REQUIRED" });
    execute.mockResolvedValueOnce({
      ...(responses["READ"] as object),
      note: { ...version, noteId: artistId },
    });
    const mismatched = await app.inject({
      method: "POST",
      url: "/api/v1/admin/artist-notes/read",
      headers,
      payload: bodies.read,
    });
    expect(mismatched.statusCode).toBe(503);
    expect(mismatched.body).not.toContain("Minji");
  } finally {
    await app.close();
  }
});
