import { expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { ManagementShell } from "../management-center/shell";
import { OrdersWorkspace } from "../management-orders/workspace";
import type { OrdersApi, OrdersContext } from "../management-orders/api";
import { AdminClientError, type AdminClient } from "../workspace/client";
import { createLedgerApi, type LedgerContext } from "./api";
import { ledgerCopy } from "./copy";
import { LedgerWorkspace } from "./workspace";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const context = (scope: "ALL" | "ASSIGNED"): LedgerContext =>
  ({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "CONTEXT",
    actorId: id(1),
    scope,
    canReadMessages: true,
    timeZone: "Asia/Shanghai",
    today: "2026-10-01",
    brokers:
      scope === "ALL"
        ? [{ brokerId: id(5), displayName: "Mina Park", active: true }]
        : [],
  }) as LedgerContext;
const idleApi = () => {
  const pending = () => new Promise<never>(() => undefined);
  return {
    context: pending,
    overview: pending,
    artist: pending,
    export: pending,
    readMessage: pending,
  } as unknown as ReturnType<typeof createLedgerApi>;
};

test("the overview offers periods, a broker filter for the studio, search and a scoped export", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const copy = ledgerCopy(locale);
    const html = renderToStaticMarkup(
      <LedgerWorkspace
        api={idleApi()}
        context={context("ALL")}
        locale={locale}
        onBusy={() => undefined}
      />,
    );
    for (const preset of [
      "TODAY",
      "THIS_WEEK",
      "THIS_MONTH",
      "LAST_MONTH",
      "CUSTOM",
    ])
      expect(html).toContain(`data-ledger-preset="${preset}"`);
    expect(html).toMatch(
      /data-ledger-preset="THIS_MONTH"[^>]*aria-pressed="true"/u,
    );
    expect(html).toContain("data-ledger-broker-filter");
    expect(html).toContain("Mina Park");
    expect(html).toContain("data-ledger-search");
    expect(html).toContain(copy.exportTable);
    expect(html).toContain(copy.rulesTitle);
    expect(html).toContain("<h2");
  }
});

test("a broker's own section is the page, without a broker filter, exporting its own artists", () => {
  const copy = ledgerCopy("zh-CN");
  const html = renderToStaticMarkup(
    <LedgerWorkspace
      api={idleApi()}
      context={context("ASSIGNED")}
      locale="zh-CN"
      onBusy={() => undefined}
      standalone
    />,
  );
  expect(html).toContain("<h1");
  expect(html).not.toContain("data-ledger-broker-filter");
  expect(html).toContain(copy.exportScopeMine);
});

test("brokers get a sidebar entry; the studio reaches the ledger from the orders area", () => {
  const sidebar = renderToStaticMarkup(
    <ManagementShell
      locale="en"
      section="LEDGER"
      artistsOnly
      ledgerAvailable
      accountAvailable
      onSection={() => undefined}
    >
      <p />
    </ManagementShell>,
  );
  expect(sidebar).toMatch(
    /data-management-section="LEDGER"[^>]*aria-current="page"/u,
  );
  expect(sidebar).not.toContain('data-management-section="GIFTS"');
  expect(sidebar).not.toContain('data-management-section="ORDERS"');
  const studio = renderToStaticMarkup(
    <ManagementShell
      locale="en"
      section="ORDERS"
      ordersAvailable
      onSection={() => undefined}
    >
      <p />
    </ManagementShell>,
  );
  expect(studio).not.toContain('data-management-section="LEDGER"');
  const orders = renderToStaticMarkup(
    <OrdersWorkspace
      api={
        {
          list: () => new Promise(() => undefined),
          detail: () => new Promise(() => undefined),
        } as unknown as OrdersApi
      }
      ledgerApi={idleApi()}
      ledgerContext={context("ALL")}
      context={{ permissions: ["orders.read"] } as unknown as OrdersContext}
      locale="en"
      onBusy={() => undefined}
    />,
  );
  expect(orders).toContain("data-ledger-navigation");
  expect(orders).toContain(ledgerCopy("en").title);
});

test("the client calls the ledger operations and rejects answers for another artist or line", async () => {
  const call = vi.fn(
    async (
      operation: string,
      command: Record<string, unknown>,
    ): Promise<unknown> => {
      if (operation === "ledger-artist")
        return {
          kind: "ARTIST",
          artist: { artistId: command["artistId"] === id(3) ? id(3) : id(4) },
        };
      if (operation === "ledger-message-read")
        return {
          kind: "MESSAGE",
          orderId: command["orderId"],
          itemId: id(99),
          intentVersion: command["expectedIntentVersion"],
        };
      return { kind: operation === "ledger-overview" ? "OVERVIEW" : "CONTEXT" };
    },
  );
  const api = createLedgerApi({ call } as unknown as AdminClient);
  await api.overview({ kind: "TODAY" }, { kind: "ALL" });
  expect(call).toHaveBeenLastCalledWith(
    "ledger-overview",
    { schemaVersion: 1, period: { kind: "TODAY" }, broker: { kind: "ALL" } },
    expect.anything(),
  );
  await expect(api.artist(id(3), { kind: "TODAY" })).resolves.toMatchObject({
    kind: "ARTIST",
  });
  await expect(api.artist(id(5), { kind: "TODAY" })).rejects.toBeInstanceOf(
    AdminClientError,
  );
  await expect(
    api.readMessage({
      orderId: id(1),
      itemId: id(2),
      expectedIntentVersion: 1,
      reviewLocale: "en",
    }),
  ).rejects.toBeInstanceOf(AdminClientError);
  await expect(
    api.export({ kind: "ALL" }, { kind: "TODAY" }),
  ).rejects.toBeInstanceOf(AdminClientError);
});
