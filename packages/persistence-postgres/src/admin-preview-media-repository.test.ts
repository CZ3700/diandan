import { expect, test, vi } from "vitest";
const path = "./admin-preview-media-repository.js";
test("media resolver rejects raw storage identities before SQL", async () => {
  const module = await import(path).catch(() => ({}));
  expect(module.createAdminPreviewMediaRepository).toBeDefined();
  const query = vi.fn();
  const repository = module.createAdminPreviewMediaRepository(
    { query },
    { trackOperation: (work: () => unknown) => work() },
  );
  expect(
    (await repository.read({ schemaVersion: 1, objectKey: "private/original" }))
      .code,
  ).toBe("INVALID_COMMAND");
  expect(query).not.toHaveBeenCalled();
});
