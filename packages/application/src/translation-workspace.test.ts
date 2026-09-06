import { expect, test, vi } from "vitest";
import {
  translationTestEnvelope,
  translationTestPrincipal,
  translationTestSnapshot,
} from "./translation-test-support.js";
const path = "./translation-workspace.js";
test("workspace rejects malformed requests before entering persistence", async () => {
  const module = await import(path).catch(() => ({}));
  expect(module.createTranslationWorkspaceUseCases).toBeDefined();
  const run = vi.fn();
  const useCases = module.createTranslationWorkspaceUseCases({
    transactions: { runInTranslationWorkspaceTransaction: run },
    tokenPepper: "aa".repeat(32),
  });
  expect(await useCases.execute({ target: "untrusted" })).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "INVALID_COMMAND",
  });
  expect(run).not.toHaveBeenCalled();
});
test("workspace authorizes the selected language before loading, and suppresses other locales", async () => {
  const module = await import(path).catch(() => ({}));
  expect(module.createTranslationWorkspaceUseCases).toBeDefined();
  const snapshot = translationTestSnapshot();
  const read = vi.fn(async () => ({
    schemaVersion: 1,
    outcome: "SUCCESS",
    context: {
      schemaVersion: 1,
      snapshot,
      previousEnglish: null,
      ownerArchived: false,
    },
  }));
  let allowed = false;
  const repositories = {
    authorization: {
      authorize: vi.fn(async (command: { locales: string[] }) =>
        allowed && command.locales.every((locale) => locale === "ja")
          ? {
              schemaVersion: 1,
              outcome: "SUCCESS",
              principal: translationTestPrincipal,
            }
          : { schemaVersion: 1, outcome: "FAILURE", code: "FORBIDDEN" },
      ),
    },
    translationWorkspace: { read },
  };
  const useCases = module.createTranslationWorkspaceUseCases({
    transactions: {
      runInTranslationWorkspaceTransaction: (
        work: (value: unknown) => Promise<unknown>,
      ) => work(repositories),
    },
    tokenPepper: "aa".repeat(32),
  });
  const request = {
    ...translationTestEnvelope,
    command: {
      schemaVersion: 1,
      action: "READ",
      target: {
        owner: snapshot.target,
        revisionId: snapshot.revisionId,
        locale: "ja",
      },
    },
  };
  expect((await useCases.execute(request)).code).toBe("FORBIDDEN");
  expect(read).not.toHaveBeenCalled();
  allowed = true;
  const result = await useCases.execute(request);
  expect(result.kind).toBe("TRANSLATION_WORKSPACE");
  expect(
    result.cells.filter(
      (cell: { access: string }) => cell.access === "RESTRICTED",
    ),
  ).toHaveLength(6);
  expect(result.selected.context.target.locale).toBe("ja");
});
