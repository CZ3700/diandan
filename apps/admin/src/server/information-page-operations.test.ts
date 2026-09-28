import { expect, test } from "vitest";
import { getAdminOperation } from "./admin-operations";
test("information pages have independent authenticated read/write BFF routes", () => {
  for (const [suffix, action] of [
    ["list", "LIST"],
    ["read", "READ"],
    ["save", "SAVE_DRAFT"],
    ["submit", "SUBMIT_REVIEW"],
    ["approve", "APPROVE_REVIEW"],
    ["publish", "PUBLISH"],
    ["unpublish", "UNPUBLISH"],
    ["restore", "RESTORE"],
    ["history", "HISTORY"],
  ]) {
    const operation = getAdminOperation(`information-pages-${suffix}`);
    expect(operation).toBeDefined();
    expect(operation!.path).toBe(`/api/v1/admin/information-pages/${suffix}`);
    expect(operation!.credentials).toBe("SESSION");
    if (suffix === "read")
      expect(
        operation!.parseCommand({
          schemaVersion: 1,
          pageKey: "ABOUT",
          locale: "en",
        }),
      ).toMatchObject({ action });
  }
});

test("BFF rejects information state for a different page, locale or mutation version", () => {
  const operation = getAdminOperation("information-pages-read")!;
  expect(operation.responseMatches).toBeTypeOf("function");
  const command = operation.parseCommand({
    schemaVersion: 1,
    pageKey: "ABOUT",
    locale: "en",
  });
  const { informationFixture } = requireFixture;
  const response = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "STATE",
    workspace: informationFixture(),
    replayed: false,
  };
  expect(operation.responseMatches!(command, response)).toBe(true);
  expect(
    operation.responseMatches!(command, {
      ...response,
      workspace: { ...response.workspace, pageKey: "FAQ" },
    }),
  ).toBe(false);
  expect(
    operation.responseMatches!(command, {
      ...response,
      workspace: { ...response.workspace, locale: "zh-CN" },
    }),
  ).toBe(false);
});
import * as requireFixture from "../management-info-pages/fixture";

test("valid maximum CJK sections fit the information save body limit", () => {
  const operation = getAdminOperation("information-pages-save")!;
  const sections = Array.from({ length: 12 }, (_, index) => ({
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    heading: "问".repeat(160),
    body: "文".repeat(4000),
  }));
  const body = {
    schemaVersion: 1,
    pageKey: "FAQ",
    locale: "en",
    expectedVersion: 0,
    revisionId: null,
    expectedSourceHash: null,
    structure: {
      sectionIds: sections.map((section) => section.id),
      contactEmail: null,
    },
    fields: { title: "题".repeat(120), summary: "介".repeat(500), sections },
  };
  expect(() =>
    operation.parseCommand(body, "information-cjk-limit-test"),
  ).not.toThrow();
  expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThanOrEqual(
    operation.bodyLimit,
  );
});
