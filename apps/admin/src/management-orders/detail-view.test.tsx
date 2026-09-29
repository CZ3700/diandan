import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as views from "./detail-view";
import { detailFixture, orderId } from "./fixtures.test-support";
import type { OrdersApi, OrdersContext } from "./api";
const context: OrdersContext = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "CONTEXT",
  actorId: orderId,
  permissions: [
    "orders.read",
    "orders.message.read",
    "orders.message.review",
    "orders.note",
  ],
  reviewLocales: ["en"],
};
test("private content requires an explicit open action and Manager controls require both permission and an allowed transition", () => {
  expect(views.OrdersDetailView).toBeTypeOf("function");
  const detail = detailFixture();
  detail.items[0]!.allowedActions = ["HOLD"];
  const props = {
    locale: "en" as const,
    detail,
    context,
    api: {} as OrdersApi,
    busy: false,
    onMutation: async () => true,
    onReload: () => {},
  };
  const html = renderToStaticMarkup(<views.OrdersDetailView {...props} />);
  expect(html).toContain("Open private message");
  expect(html).toContain("Open notes");
  expect(html).not.toContain("data-private-content");
  expect(html).not.toContain("data-manager-actions");
  expect(html).not.toContain("Mark delivered");
  const manager = renderToStaticMarkup(
    <views.OrdersDetailView
      {...props}
      context={{
        ...context,
        permissions: [...context.permissions, "orders.manage"],
      }}
    />,
  );
  expect(manager).toContain("data-manager-actions");
  expect(manager).toContain('type="checkbox"');
  expect(manager).not.toContain("data-private-content");
});

test("pending message review stays distinct from pending gift preparation", () => {
  const html = renderToStaticMarkup(
    <views.OrdersDetailView
      locale="zh-CN"
      detail={detailFixture()}
      context={context}
      api={{} as OrdersApi}
      busy={false}
      onMutation={async () => true}
      onReload={() => {}}
    />,
  );
  expect(html).toContain("留言审核: 等待审核");
  expect(html).not.toContain("留言审核: 待准备");
  expect(html).toContain("待准备");
});

test("delivery opens a private photo panel, and photos are offered only to delivery staff", async () => {
  const { adminOrdersProofSchema } = await import("@fan-support/contracts");
  const { DeliveryProofPanel } = await import("./delivery-proof-panel");
  const render = (
    detail: ReturnType<typeof detailFixture>,
    permissions: typeof context.permissions,
  ) =>
    renderToStaticMarkup(
      <views.OrdersDetailView
        locale="en"
        detail={detail}
        context={{ ...context, permissions }}
        api={{} as OrdersApi}
        busy={false}
        onMutation={async () => true}
        onReload={() => {}}
      />,
    );
  const preparing = detailFixture();
  Object.assign(preparing.items[0]!, {
    giftKind: "PHYSICAL",
    allowedActions: ["DELIVER"],
    proofActions: ["ATTACH"],
  });
  const opener = render(preparing, ["orders.read", "orders.fulfillment"]);
  expect(opener).toContain("data-order-deliver");
  expect(opener).toContain("Mark delivered");
  expect(opener).not.toContain("data-proof-panel");
  expect(opener).not.toContain("data-order-add-proofs");
  const delivered = detailFixture();
  Object.assign(delivered.items[0]!, {
    giftKind: "PHYSICAL",
    allowedActions: [],
    proofActions: ["ATTACH", "WITHDRAW"],
    proofs: [
      adminOrdersProofSchema.parse({
        proofId: orderId,
        sequence: 1,
        createdAt: "2026-09-27T00:00:00.000Z",
        width: 1600,
        height: 1200,
        thumbnailWidth: 480,
        thumbnailHeight: 360,
      }),
    ],
  });
  const staff = render(delivered, [
    "orders.read",
    "orders.fulfillment",
    "orders.manage",
  ]);
  expect(staff).toContain("data-order-add-proofs");
  expect(staff).toContain("Delivery photos · 1/3");
  expect(staff).toContain("data-proofs-view");
  // Private photos load only on request, through short-lived grants.
  expect(staff.slice(staff.indexOf("data-order-proofs"))).not.toContain("<img");
  const support = render(delivered, ["orders.read"]);
  expect(support).toContain("Delivery photos · 1/3");
  expect(support).not.toContain("data-proofs-view");
  const panel = (mode: "DELIVER" | "ATTACH") =>
    renderToStaticMarkup(
      <DeliveryProofPanel
        mode={mode}
        line={preparing.items[0]!}
        detail={preparing}
        api={{} as OrdersApi}
        locale="en"
        busy={false}
        onMutation={async () => true}
        onClose={() => {}}
      />,
    );
  const deliver = panel("DELIVER");
  expect(deliver).toContain("data-proof-privacy");
  expect(deliver).toContain("crop out other people&#x27;s faces");
  expect(deliver).toContain('accept="image/jpeg,image/png,image/webp"');
  expect(deliver).toMatch(/data-proof-submit="DELIVER"(?![^>]*disabled)/u);
  expect(panel("ATTACH")).toMatch(/data-proof-submit="ATTACH"[^>]*disabled/u);
});

// User request 2026-09-29: delivery work first; payments and refunds wait, folded, at the
// bottom; states carry the same colour tones as the list.
test("delivery comes first and payments and refunds wait behind one control at the bottom", async () => {
  const { financeFixture } =
    await import("../management-finance/fixtures.test-support");
  const html = renderToStaticMarkup(
    <views.OrdersDetailView
      locale="en"
      detail={detailFixture()}
      context={context}
      api={{} as OrdersApi}
      financeApi={{ detail: async () => financeFixture() } as never}
      onFinanceBusy={() => {}}
      busy={false}
      onMutation={async () => true}
      onReload={() => {}}
    />,
  );
  const lines = html.indexOf('class="mo-lines"');
  const notification = html.indexOf('id="order-notification"');
  const notes = html.indexOf('id="order-notes"');
  const finance = html.indexOf("data-finance-panel");
  expect(lines).toBeGreaterThan(-1);
  expect(lines).toBeLessThan(notification);
  expect(notification).toBeLessThan(notes);
  expect(notes).toBeLessThan(finance);
  expect(html).toMatch(/data-finance-toggle[^>]*aria-expanded="false"/u);
  expect(html).not.toContain("data-finance-refresh");
  expect(html).toMatch(
    /class="mo-status" data-tone="[a-z]+" data-status-kind="payment"/u,
  );
  expect(html).toMatch(
    /class="mo-line-status mo-status" data-tone="[a-z]+" data-status-kind="fulfillment"/u,
  );
});
