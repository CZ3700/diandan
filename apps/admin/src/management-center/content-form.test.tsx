import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  managementCenterResponseSchema,
  SUPPORTED_LOCALES,
  slugSchema,
} from "@fan-support/contracts";
import { ContentForm } from "./content-form";
import type { ManagementContext } from "./api";
const context = managementCenterResponseSchema.parse({
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "CONTEXT",
  capability: "DIRECT_OPERATOR_V1",
  markets: [{ market: "GLOBAL", currencies: ["USD"] }],
  defaults: {
    priceScope: { market: "GLOBAL", currency: "USD" },
    inventoryPolicy: "PROCURE_ON_DEMAND",
    inventoryLocationId: null,
    eligibility: "ALL_ACTIVE_ARTISTS",
  },
  giftKinds: ["PHYSICAL", "VIRTUAL", "WISH", "MERCHANDISE"],
  categories: ["OTHER", "FLOWERS"],
  poster: { available: false, version: 0, currentRevisionId: null },
  operations: [],
  artists: { scope: "ALL", canAssign: false, brokers: [] },
}) as ManagementContext;
it.each(SUPPORTED_LOCALES)(
  "renders one artist submit action, real file input and optional source-language settings in %s",
  (locale) => {
    const html = renderToStaticMarkup(
      <ContentForm
        locale={locale}
        context={context}
        kind="SAVE_ARTIST"
        item={null}
        busy={false}
        onSubmit={() => {}}
      />,
    );
    expect(html).toContain('type="file"');
    expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(html.match(/<label\b[^>]*for="management-image"/gu)).toHaveLength(1);
    expect(html).toContain('aria-labelledby="management-image-label"');
    expect(html).toContain('maxLength="40"');
    expect(html).toContain('maxLength="600"');
    expect(html.match(/type="submit"/gu)).toHaveLength(1);
    expect(html).toContain("<details");
    expect(html).not.toContain("<details open");
    expect(html).toContain(`value="${locale}" selected=""`);
    expect(html).not.toMatch(
      /handle|revisionId|priceBook|reviewer|role="dialog"/u,
    );
  },
);
it("does not ask for fictitious stock on the default repeatable gift", () => {
  const html = renderToStaticMarkup(
    <ContentForm
      locale="zh-CN"
      context={context}
      kind="SAVE_GIFT"
      item={null}
      busy={false}
      onSubmit={() => {}}
    />,
  );
  expect(html).toContain('maxLength="100"');
  expect(html).toContain('data-management-field="price"');
  expect(html).toContain('data-management-field="giftKind"');
  expect(html).not.toContain('data-management-field="quantity"');
  expect(html).toContain('value="PROCURE_ON_DEMAND" selected=""');
  expect(html).not.toMatch(
    /<select[^>]*data-management-field="(?:market|currency)"[^>]*disabled=""/u,
  );
});
it("disables the whole form during the active upload or publication", () => {
  const html = renderToStaticMarkup(
    <ContentForm
      locale="en"
      context={context}
      kind="SAVE_ARTIST"
      item={null}
      busy
      onSubmit={() => {}}
    />,
  );
  expect(html).toMatch(/<fieldset[^>]*disabled=""/u);
});
it("locks only an existing inventory policy while leaving zero quantity and content editable", () => {
  const gift = {
    kind: "GIFT" as const,
    id: "10000000-0000-4000-8000-000000000001",
    version: 1,
    sourceLocale: "zh-CN" as const,
    name: "测试现货",
    description: "实际库存资料",
    image: null,
    status: "active" as const,
    handle: slugSchema.parse("test-stock"),
    giftKind: "PHYSICAL" as const,
    category: "OTHER" as const,
    price: null,
    inventory: {
      policy: "TRACKED" as const,
      quantity: 0,
      locationId: "10000000-0000-4000-8000-000000000002",
    },
    eligibility: { rule: "ALL_ACTIVE_ARTISTS" as const },
    canEdit: true,
    inventoryPolicyLocked: true,
  };
  const html = renderToStaticMarkup(
    <ContentForm
      locale="zh-CN"
      context={context}
      kind="SAVE_GIFT"
      item={gift}
      busy={false}
      onSubmit={() => {}}
    />,
  );
  expect(html).toMatch(
    /<select[^>]*data-management-field="policy"[^>]*disabled=""/u,
  );
  expect(html).toContain("已有库存记录，售卖方式需保持不变");
  expect(html).toMatch(
    /<input[^>]*data-management-field="quantity"[^>]*value="0"/u,
  );
  expect(html).not.toMatch(/<fieldset[^>]*disabled=""/u);
  expect(html).not.toMatch(
    /<input[^>]*data-management-field="(?:quantity|name|price)"[^>]*disabled=""/u,
  );
  expect(html).toContain("保存并显示");
  expect(html).toMatch(
    /<select[^>]*data-management-field="market"[^>]*disabled=""/u,
  );
  expect(html).toMatch(
    /<select[^>]*data-management-field="currency"[^>]*disabled=""/u,
  );
  expect(html).not.toContain('data-management-field="locationId"');
});
