import { expect, test, vi } from "vitest";
import { createLocalAdminArtistNotesComposition } from "./admin-artist-notes-composition.js";

const options = {
  environment: "LOCAL_OIDC" as const,
  database: {
    schemaVersion: 1 as const,
    maxConnections: 2,
    connectionString: "postgres://local:local@localhost:5432/test",
  },
  allowedOrigin: "https://admin.example.invalid",
  tokenPepper: "a".repeat(64),
  keys: { encryptEnvelope: vi.fn(), decryptEnvelope: vi.fn() } as never,
};

test("the local artist notes composition owns one pool, borrows the key service and closes once", async () => {
  const close = vi.fn(async () => {}),
    runInAdminArtistNoteTransaction = vi.fn();
  const createPersistence = vi.fn(() => ({
    adminArtistNoteTransactionManager: { runInAdminArtistNoteTransaction },
    close,
  }));
  const composition = createLocalAdminArtistNotesComposition(options, {
    createPersistence,
  });
  expect(createPersistence).toHaveBeenCalledTimes(1);
  expect(composition.adminArtistNotesRoute.allowedOrigin).toBe(
    options.allowedOrigin,
  );
  await composition.adminArtistNotesRuntime.start();
  await Promise.all([
    composition.adminArtistNotesRuntime.stop(),
    composition.adminArtistNotesRuntime.stop(),
  ]);
  expect(close).toHaveBeenCalledTimes(1);
});

test("unsafe origins, peppers or a key service that cannot encrypt never build the notes", () => {
  const createPersistence = vi.fn(() => ({
    adminArtistNoteTransactionManager: {
      runInAdminArtistNoteTransaction: vi.fn(),
    },
    close: vi.fn(async () => {}),
  }));
  for (const bad of [
    { allowedOrigin: "http://admin.example.invalid" },
    { tokenPepper: "short" },
    { environment: "PRODUCTION" },
    { keys: { decryptEnvelope: vi.fn() } },
  ])
    expect(() =>
      createLocalAdminArtistNotesComposition({ ...options, ...bad } as never, {
        createPersistence,
      }),
    ).toThrow(TypeError);
  expect(createPersistence).not.toHaveBeenCalled();
});
