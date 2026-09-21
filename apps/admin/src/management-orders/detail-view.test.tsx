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
