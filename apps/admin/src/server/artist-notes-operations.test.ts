import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getAdminOperation } from "./admin-operations";
import { createAdminBff } from "./admin-bff";

const artistId = "10000000-0000-4000-8000-000000000001",
  noteId = "10000000-0000-4000-8000-000000000002";
const content = { realName: "", contact: "", identity: "", other: "" };

test("artist note operations have fixed routes, and only a save changes anything", () => {
  const expected = {
    "artist-notes-context": ["/api/v1/admin/artist-notes/context", true],
    "artist-notes-read": ["/api/v1/admin/artist-notes/read", true],
    "artist-notes-save": ["/api/v1/admin/artist-notes/save", false],
  } as const;
  for (const [key, [path, readOnly]] of Object.entries(expected)) {
    const operation = getAdminOperation(key);
    expect(operation?.path).toBe(path);
    expect(operation?.readOnly).toBe(readOnly);
  }
  const save = getAdminOperation("artist-notes-save")!;
  const command = save.parseCommand(
    { schemaVersion: 1, artistId, noteId, expectedVersion: 0, content },
    "a".repeat(32),
  );
  expect(command).toMatchObject({ action: "SAVE", noteId });
  expect(save.apiBody(command)).not.toHaveProperty("action");
  for (const forged of [
    { action: "READ" },
    { actorId: artistId },
    { idempotencyKey: "x" },
  ])
    expect(() =>
      save.parseCommand({
        schemaVersion: 1,
        artistId,
        noteId,
        expectedVersion: 0,
        content,
        ...forged,
      }),
    ).toThrow();
  expect(() =>
    getAdminOperation("artist-notes-context")!.parseResponse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "SAVED",
      artistId,
      note: {
        noteId,
        version: 1,
        savedAt: "2026-10-01T02:00:00.000Z",
        savedBy: "Studio owner",
      },
    }),
  ).toThrow();
});

test("an API without the notes route reads as not found, so the editor simply leaves the section out", async () => {
  const config = {
    schemaVersion: 1,
    mode: "TEST",
    siteOrigin: "http://localhost:3100",
    internalApiOrigin: "http://127.0.0.1:3200",
  } as const;
  const csrf = "c".repeat(43),
    session = "s".repeat(43);
  const missing = await createAdminBff({
    config,
    fetch: async () =>
      Response.json({ message: "Route unavailable" }, { status: 404 }),
  }).operation(
    new Request(`${config.siteOrigin}/api/admin/artist-notes-context`, {
      method: "POST",
      headers: {
        origin: config.siteOrigin,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        "x-csrf-token": csrf,
        cookie: `__Host-fan-admin-session=${session}; __Host-fan-admin-csrf=${csrf}`,
      },
      body: JSON.stringify({ schemaVersion: 1, artistId }),
    }),
    "artist-notes-context",
  );
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "NOT_FOUND",
  });
});
