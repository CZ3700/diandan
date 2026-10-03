import { expect, test, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import type * as React from "react";
import { adminFinanceResponseSchema } from "@fan-support/contracts";
import { FinanceDetailView } from "./detail-view";

const queued = vi.hoisted(
  () => [] as Array<(value: Record<string, string>) => Record<string, string>>,
);
vi.mock("react", async (original) => {
  const react = await original<typeof React>();
  return {
    ...react,
    useId: () => "finance-input-test",
    useRef: () => ({ current: null }),
    useEffect: () => {},
    useState: (value: unknown) => [
      value === "FULL" ? "PARTIAL" : value,
      (next: unknown) => {
        if (
          typeof value === "object" &&
          value !== null &&
          typeof next === "function"
        )
          queued.push(
            next as (value: Record<string, string>) => Record<string, string>,
          );
      },
    ],
  };
});

test("two refund inputs retain their values when React runs state updaters after the event ends", () => {
  queued.length = 0;
  const id = "10000000-0000-4000-8000-000000000001";
  const second = "10000000-0000-4000-8000-000000000002";
  const detail = adminFinanceResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "DETAIL",
    canManage: true,
    canCancel: false,
    order: {
      orderId: id,
      publicOrderId: id,
      publicOrderNo: "FS-7K3M9C",
      version: 1,
      presentationLocale: "en",
      orderStatus: "OPEN",
      paymentStatus: "PAID",
      disputeStatus: "NONE",
      currency: "USD",
      totalAmountMinor: 1000,
      capturedAmountMinor: 1000,
      occupiedRefundAmountMinor: 0,
      refundedAmountMinor: 0,
      availableRefundAmountMinor: 1000,
      needsReconciliation: false,
      updatedAt: "2026-09-22T00:00:00Z",
    },
    items: [id, second].map((orderItemId, index) => ({
      orderItemId,
      position: index + 1,
      amountMinor: 500,
      occupiedAmountMinor: 0,
      availableAmountMinor: 500,
    })),
    attempts: [],
    refunds: [],
    disputes: [],
    issues: [],
  });
  if (detail.outcome !== "SUCCESS" || detail.kind !== "DETAIL")
    throw new Error("Invalid fixture");
  const inputs: Array<{ onChange: (event: unknown) => void }> = [];
  function visit(node: ReactNode): void {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (
      !isValidElement<{
        children?: ReactNode;
        "data-finance-item"?: string;
        onChange?: (event: unknown) => void;
      }>(node)
    )
      return;
    if (node.props["data-finance-item"] && node.props.onChange)
      inputs.push({ onChange: node.props.onChange });
    visit(node.props.children);
  }
  visit(
    FinanceDetailView({
      detail,
      locale: "en",
      busy: false,
      locked: false,
      submit: () => {},
    }),
  );
  expect(inputs).toHaveLength(2);
  for (const [index, input] of inputs.entries()) {
    const event: { currentTarget: { value: string } | null } = {
      currentTarget: { value: `0.0${index + 1}` },
    };
    input.onChange(event);
    event.currentTarget = null;
  }
  expect(queued).toHaveLength(2);
  const applyUpdates = () =>
    queued.reduce((value, update) => update(value), {});
  expect(applyUpdates).not.toThrow();
  expect(applyUpdates()).toEqual({ [id]: "0.01", [second]: "0.02" });
});
