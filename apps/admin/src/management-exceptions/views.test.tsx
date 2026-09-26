import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import {
  SUPPORTED_LOCALES,
  adminExceptionItemSchema,
} from "@fan-support/contracts";
const subject = await import("./detail-view").catch(() => undefined);
const copies = await import("./copy").catch(() => undefined);
const manifest = await import("./review-manifest").catch(() => undefined);
const id = "10000000-0000-4000-8000-000000000001";
const item = adminExceptionItemSchema.parse({
  target: { kind: "NOTIFICATION", id, consumerKey: null },
  version: "a".repeat(64),
  orderId: id,
  publicOrderId: id,
  publicOrderNo: "FS-7K3M9C",
  status: "UNKNOWN",
  attemptCount: 1,
  updatedAt: "2026-09-22T00:00:00Z",
  allowedAction: null,
  blockedReason: "NOTIFICATION_UNCERTAIN",
});
test("uncertain notifications show a concrete next step and no resend control", () => {
  expect(subject?.ExceptionDetailView).toBeTypeOf("function");
  const View = subject!.ExceptionDetailView;
  const html = renderToStaticMarkup(
    <View
      detail={{
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "DETAIL",
        item,
        operations: [],
      }}
      locale="zh-CN"
      busy={false}
      mutate={() => {}}
    />,
  );
  expect(html).toContain("需先核实投递结果");
  expect(html).not.toContain("data-exceptions-submit");
  expect(html).not.toContain(item.version);
});
test("action form requires reason and explicit confirmation, and read-only source has no action", () => {
  expect(subject?.ExceptionDetailView).toBeTypeOf("function");
  const View = subject!.ExceptionDetailView;
  const detail = {
    schemaVersion: 1 as const,
    outcome: "SUCCESS" as const,
    kind: "DETAIL" as const,
    item: {
      ...item,
      status: "FAILED" as const,
      allowedAction: "RETRY_NOTIFICATION" as const,
      blockedReason: "NONE" as const,
    },
    operations: [],
  };
  const html = renderToStaticMarkup(
    <View detail={detail} locale="en" busy={false} mutate={() => {}} />,
  );
  expect(html).toContain("data-exceptions-reason");
  expect(html).toContain("data-exceptions-confirm");
  expect(html).toMatch(
    /disabled=""[^>]*data-exceptions-submit|data-exceptions-submit[^>]*disabled=""/,
  );
  const readonly = renderToStaticMarkup(
    <View
      detail={{
        ...detail,
        item: {
          ...detail.item,
          allowedAction: null,
          blockedReason: "READ_ONLY",
        },
      }}
      locale="en"
      busy={false}
      mutate={() => {}}
    />,
  );
  expect(readonly).not.toContain("data-exceptions-submit");
});
test("all seven copy catalogs and draft review hashes remain complete", () => {
  expect(copies?.exceptionsCopy).toBeTypeOf("function");
  expect(manifest?.exceptionCopyReviews).toBeDefined();
  const hash = (value: unknown) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
  for (const locale of SUPPORTED_LOCALES) {
    const c = copies!.exceptionsCopy(locale);
    expect(Object.keys(c)).toEqual(Object.keys(copies!.exceptionsCopy("en")));
    expect(
      Object.values(c).every((x) => typeof x === "string" && x.length > 0),
    ).toBe(true);
    expect(
      manifest!.exceptionCopyReviews.find((r) => r.locale === locale),
    ).toMatchObject({
      status: "DRAFT",
      reviewer: null,
      sourceHash: hash(copies!.exceptionsCopy("en")),
      translationHash: hash(c),
    });
  }
});
