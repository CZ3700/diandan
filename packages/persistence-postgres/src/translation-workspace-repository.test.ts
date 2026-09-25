import { expect, test, vi } from "vitest";
const path = "./translation-workspace-repository.js";
test("workspace repository rejects arbitrary owner and locale inputs without SQL", async () => {
  const module = await import(path).catch(() => ({}));
  expect(module.createTranslationWorkspaceRepository).toBeDefined();
  const query = vi.fn();
  const repository = module.createTranslationWorkspaceRepository(
    { query },
    { trackOperation: (work: () => unknown) => work() },
  );
  expect(
    (
      await repository.read({
        action: "READ",
        target: { owner: { kind: "arbitrary_table" } },
      })
    ).code,
  ).toBe("INVALID_COMMAND");
  expect(query).not.toHaveBeenCalled();
});
