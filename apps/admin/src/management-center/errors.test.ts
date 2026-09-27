import { expect, it } from "vitest";
import { managementError } from "./errors";
import { managementCopy } from "./copy";
import { AdminClientError } from "../workspace/client";

it("explains why an existing inventory policy cannot change without blocking other edits", () => {
  expect(
    managementError(
      new AdminClientError("INVENTORY_POLICY_LOCKED"),
      managementCopy("zh-CN"),
    ),
  ).toContain("已有库存记录，售卖方式需保持不变");
});
it("asks to reload when a delete meets a version changed elsewhere", () => {
  const copy = managementCopy("en");
  expect(managementError(new AdminClientError("STALE_VERSION"), copy)).toBe(
    copy.conflict,
  );
});
