import { createHash } from "node:crypto";
import {
  SUPPORTED_LOCALES,
  orderNotificationRenderCommandSchema,
  type OrderNotificationEventType,
  type SupportedLocale,
} from "@fan-support/contracts";
import { expect, it } from "vitest";

const events: readonly OrderNotificationEventType[] = [
  "PAYMENT_CONFIRMED",
  "PREPARING",
  "DELIVERED",
];
const publicOrderId = "71000000-0000-4000-8000-000000000001";
const publicOrderNo = "FS-7K3M9C";
const rawToken = "A".repeat(43);
const variables = {
  schemaVersion: 1 as const,
  siteName: "Studio Preview",
  publicOrderId,
  publicOrderNo,
  orderedAt: "2026-09-15T23:30:00-07:00",
  currency: "USD",
  totalMinor: 12345,
  items: [
    {
      idolName: "星の名前",
      idolLocale: "ja",
      giftName: "鲜花与心意",
      giftLocale: "zh-CN",
      variantName: null,
      variantLocale: null,
      quantity: 3,
      lineTotalMinor: 12345,
    },
  ],
  orderUrl: `https://store.example/en/order-access#token=${rawToken}&order=${publicOrderId}`,
};

async function api() {
  const module = await import("./index.js").catch(() => undefined);
  expect(
    module,
    "versioned order notification renderer must exist",
  ).toBeDefined();
  return module!;
}

function command(
  selection: {
    eventType: OrderNotificationEventType;
    requestedLocale: SupportedLocale;
    resolvedLocale: SupportedLocale;
    fallbackUsed: boolean;
    templateKey: string;
    templateVersion: string;
  },
  overrides = {},
) {
  const {
    eventType,
    requestedLocale,
    resolvedLocale,
    fallbackUsed,
    templateKey,
    templateVersion,
  } = selection;
  return orderNotificationRenderCommandSchema.parse({
    schemaVersion: 1,
    eventType,
    locale: {
      schemaVersion: 1,
      requestedLocale,
      resolvedLocale,
      fallbackUsed,
      templateKey,
      templateVersion,
      contentRevisionIds: [],
    },
    variables: { ...variables, ...overrides },
  });
}

it("renders all three events completely in all seven locales with original snapshot language", async () => {
  const { createOrderNotificationTemplates } = await api();
  const templates = createOrderNotificationTemplates({ mode: "TEST_DRAFT" });
  for (const locale of SUPPORTED_LOCALES)
    for (const event of events) {
      const selection = templates.select(event, locale);
      expect(selection.templateVersion).toMatch(/^v3\.[a-f0-9]{64}$/u);
      expect(selection).toMatchObject({
        requestedLocale: locale,
        resolvedLocale: locale,
        fallbackUsed: false,
      });
      const content = templates.render(command(selection));
      for (const field of ["subject", "preheader", "html", "text"] as const)
        expect(content[field].length).toBeGreaterThan(10);
      expect(content.html).toContain(`<html lang="${locale}">`);
      expect(content.html).toContain('lang="ja"');
      expect(content.html).toContain('lang="zh-CN"');
      expect(content.html).toContain("鲜花与心意");
      expect(content.text).toContain(publicOrderNo);
      expect(content.text).toContain("123");
      expect(content.subject + content.preheader + content.text).not.toMatch(
        /\{\w+\}/u,
      );
      expect(content.html).not.toContain("undefined");
    }
});

it("marks digital support lines and adds the support-record note only when a VIRTUAL line exists", async () => {
  const { createOrderNotificationTemplates } = await api();
  const templates = createOrderNotificationTemplates({ mode: "TEST_DRAFT" });
  for (const locale of SUPPORTED_LOCALES) {
    const selection = templates.select("PAYMENT_CONFIRMED", locale);
    const studio = templates.render(
      command(selection, {
        items: [{ ...variables.items[0], giftKind: "PHYSICAL" }],
      }),
    );
    expect(studio.html).not.toContain("data-mail-digital");
    const mixed = templates.render(
      command(selection, {
        items: [
          { ...variables.items[0], giftKind: "VIRTUAL" },
          { ...variables.items[0], giftName: "Studio gift", giftKind: null },
        ],
      }),
    );
    expect(mixed.html.match(/data-mail-digital-note/gu)).toHaveLength(1);
    expect(mixed.html.match(/data-mail-digital\s/gu)).toHaveLength(1);
    expect(mixed.text).not.toContain("undefined");
    expect(mixed.text.length).toBeGreaterThan(studio.text.length);
    expect(mixed.subject).toBe(studio.subject);
  }
});

it("shows the public order number and keeps the UUID only inside the link", async () => {
  const { createOrderNotificationTemplates } = await api();
  const templates = createOrderNotificationTemplates({ mode: "TEST_DRAFT" });
  for (const locale of SUPPORTED_LOCALES) {
    const selection = templates.select("PREPARING", locale);
    const content = templates.render(command(selection));
    expect(content.html).toMatch(
      new RegExp(`data-mail-order[^>]*>${publicOrderNo}</div>`, "u"),
    );
    const withoutLink = (value: string) =>
      value
        .replaceAll(variables.orderUrl.replaceAll("&", "&amp;"), "")
        .replaceAll(variables.orderUrl, "");
    expect(withoutLink(content.html)).not.toContain(publicOrderId);
    expect(withoutLink(content.text)).not.toContain(publicOrderId);
    expect(() =>
      templates.render(command(selection, { publicOrderNo: null })),
    ).toThrow("NOTIFICATION_VARIABLES_INVALID");
  }
});

it("still renders archived v1 selections byte-for-byte without a gift kind", async () => {
  const { createOrderNotificationTemplates } = await api();
  const { templateVersionV1, eventTemplateKeys } =
    await import("./v1/identity.js");
  const templates = createOrderNotificationTemplates({ mode: "TEST_DRAFT" });
  const archived = command({
    eventType: "DELIVERED",
    requestedLocale: "th",
    resolvedLocale: "th",
    fallbackUsed: false,
    templateKey: eventTemplateKeys.DELIVERED,
    templateVersion: templateVersionV1("DELIVERED"),
  });
  const content = templates.render(archived);
  expect(content.html).toContain('<html lang="th">');
  // v1 predates public numbers: it keeps showing the UUID it was reviewed with.
  expect(content.text).toContain(`: ${publicOrderId}`);
  expect(
    templates.render({
      ...archived,
      variables: { ...archived.variables, publicOrderNo: null },
    }).text,
  ).toBe(content.text);
  expect(content.html).not.toContain("data-mail-digital");
  expect(templates.select("DELIVERED", "th").templateVersion).not.toBe(
    archived.locale.templateVersion,
  );
});

it("allows real sends once the current templates carry exact approved evidence, including English incident fallback", async () => {
  const { createOrderNotificationTemplates } = await api();
  const approved = createOrderNotificationTemplates({ mode: "APPROVED" });
  expect(approved.select("PAYMENT_CONFIRMED", "th").templateVersion).toMatch(
    /^v3\./u,
  );
  expect(() =>
    createOrderNotificationTemplates({
      mode: "APPROVED",
      incidentFallbackLocales: ["ja"],
    }),
  ).not.toThrow();
});

it("falls back as one whole English template and keeps replay independent of current incident configuration", async () => {
  const { createOrderNotificationTemplates } = await api();
  const ordinary = createOrderNotificationTemplates({ mode: "TEST_DRAFT" });
  const incident = createOrderNotificationTemplates({
    mode: "TEST_DRAFT",
    incidentFallbackLocales: ["ja"],
  });
  const selection = incident.select("PREPARING", "ja");
  expect(selection).toMatchObject({
    requestedLocale: "ja",
    resolvedLocale: "en",
    fallbackUsed: true,
    fallbackReasonCode: "LOCALE_TEMPLATE_INCIDENT",
  });
  const frozen = command(selection);
  expect(incident.render(frozen)).toEqual(ordinary.render(frozen));
  expect(incident.render(frozen).html).toContain('<html lang="en">');
  expect(incident.render(frozen).text).toContain("started preparing");
  expect(incident.select("PREPARING", "en").fallbackUsed).toBe(false);
});

it("rejects changed versions and mismatched event/template identities without printing credentials", async () => {
  const { createOrderNotificationTemplates } = await api();
  const templates = createOrderNotificationTemplates({ mode: "TEST_DRAFT" });
  const frozen = command(templates.select("DELIVERED", "en"));
  expect(() =>
    templates.render({
      ...frozen,
      locale: { ...frozen.locale, templateVersion: `v1.${"0".repeat(64)}` },
    }),
  ).toThrow("NOTIFICATION_TEMPLATE_VERSION_UNAVAILABLE");
  expect(() => templates.render({ ...frozen, eventType: "PREPARING" })).toThrow(
    "NOTIFICATION_TEMPLATE_IDENTITY_INVALID",
  );
  expect(() =>
    templates.render({
      ...frozen,
      variables: { ...frozen.variables, orderUrl: "javascript:" + rawToken },
    }),
  ).toThrow("NOTIFICATION_VARIABLES_INVALID");
});

it("escapes untrusted historical content in HTML while keeping the exact plain text", async () => {
  const { createOrderNotificationTemplates } = await api();
  const templates = createOrderNotificationTemplates({ mode: "TEST_DRAFT" });
  const unsafe = '<img src=x onerror="alert(1)"> & gift';
  const output = templates.render(
    command(templates.select("PAYMENT_CONFIRMED", "en"), {
      siteName: 'A & "Studio"',
      items: [
        {
          ...variables.items[0],
          giftName: unsafe,
          variantName: "Size <L>",
          variantLocale: "en",
        },
      ],
    }),
  );
  expect(output.html).toContain(
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; gift",
  );
  expect(output.html).not.toContain("<img src=x");
  expect(output.text).toContain(unsafe);
  expect(output.html).toContain("Size &lt;L&gt;");
  expect(output.html).toContain("&amp;order=");
});

it("formats integer minor amounts exactly including maximum safe integer and non-two-decimal currencies", async () => {
  const { createOrderNotificationTemplates } = await api();
  const templates = createOrderNotificationTemplates({ mode: "TEST_DRAFT" });
  const selection = templates.select("PAYMENT_CONFIRMED", "en");
  for (const [currency, totalMinor, expected] of [
    ["USD", 9007199254740991, "90,071,992,547,409.91"],
    ["JPY", 12345, "12,345"],
    ["KWD", 12345, "12.345"],
  ] as const) {
    const output = templates.render(
      command(selection, {
        currency,
        totalMinor,
        items: [{ ...variables.items[0], lineTotalMinor: totalMinor }],
      }),
    );
    expect(output.text).toContain(expected);
  }
});

it("uses the real order date in UTC, deterministic bytes, and a one-time latest-link notice", async () => {
  const { createOrderNotificationTemplates } = await api();
  const templates = createOrderNotificationTemplates({ mode: "TEST_DRAFT" });
  const frozen = command(templates.select("DELIVERED", "en"));
  const content = templates.render(frozen);
  expect(content.text).toContain("Sep 16, 2026");
  expect(content.text).toContain("UTC");
  expect(content.text).toContain("works once");
  expect(content.text).toContain("use the link in the most recent one");
  expect(content.text).not.toMatch(
    /settled|estimated|arrive|delivered at|prepared at/iu,
  );
  expect(
    createHash("sha256").update(JSON.stringify(content)).digest("hex"),
  ).toBe(
    createHash("sha256")
      .update(JSON.stringify(templates.render(frozen)))
      .digest("hex"),
  );
});

it("rejects a credential URL for another order", async () => {
  const { createOrderNotificationTemplates } = await api();
  const templates = createOrderNotificationTemplates({ mode: "TEST_DRAFT" });
  const frozen = command(templates.select("PREPARING", "en"));
  expect(() =>
    templates.render({
      ...frozen,
      variables: {
        ...frozen.variables,
        orderUrl: frozen.variables.orderUrl.replace(
          publicOrderId,
          "71000000-0000-4000-8000-000000000002",
        ),
      },
    }),
  ).toThrow("NOTIFICATION_VARIABLES_INVALID");
});

it("renders a bounded historical summary for the largest legal order and keeps the full total", async () => {
  const { createOrderNotificationTemplates } = await api();
  const templates = createOrderNotificationTemplates({ mode: "TEST_DRAFT" });
  for (const locale of SUPPORTED_LOCALES) {
    const items = Array.from({ length: 500 }, (_, index) => ({
      ...variables.items[0],
      idolName: '"'.repeat(1000),
      giftName: `${index.toString().padStart(3, "0")}${"&".repeat(997)}`,
      variantName: "<".repeat(1000),
      variantLocale: "en",
      lineTotalMinor: 100,
    }));
    const result = templates.render(
      command(templates.select("PAYMENT_CONFIRMED", locale), {
        items,
        totalMinor: 50000,
      }),
    );
    expect(result.html.match(/data-mail-item /gu)).toHaveLength(10);
    expect(result.text).toContain(new Intl.NumberFormat(locale).format(490));
    expect(result.text).toContain("500");
    expect(result.text).not.toContain(`010${"&".repeat(997)}`);
    expect(result.html.length).toBeLessThan(250000);
    expect(result.text.length).toBeLessThan(100000);
    expect(result.html).toContain("data-mail-summary");
  }
});

it("omits a remainder notice for ten or fewer items and handles the singular eleventh item", async () => {
  const { createOrderNotificationTemplates } = await api();
  const templates = createOrderNotificationTemplates({ mode: "TEST_DRAFT" });
  const selection = templates.select("PAYMENT_CONFIRMED", "en");
  const items = Array.from({ length: 10 }, () => variables.items[0]);
  expect(templates.render(command(selection, { items })).html).not.toContain(
    "data-mail-summary",
  );
  const eleven = templates.render(
    command(selection, { items: [...items, variables.items[0]] }),
  );
  expect(eleven.text).toContain("1 more gift");
  expect(eleven.text).toContain("full order");
});

it("describes historical events without promising the order's current readiness", async () => {
  const { createOrderNotificationTemplates } = await api();
  const templates = createOrderNotificationTemplates({ mode: "TEST_DRAFT" });
  const paid = templates.render(
    command(templates.select("PAYMENT_CONFIRMED", "en")),
  );
  expect(paid.text).not.toContain("ready for the studio");
  expect(paid.text).toContain("current status");
  const preparing = templates.render(
    command(templates.select("PREPARING", "en")),
  );
  expect(preparing.subject).toContain("has started preparing");
  expect(preparing.text).toContain("has started preparing");
  expect(
    preparing.subject + preparing.preheader + preparing.text,
  ).not.toContain("is preparing");
});
