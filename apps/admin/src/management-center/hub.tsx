"use client";
import { useEffect, useState } from "react";
import type { SupportedLocale } from "@fan-support/contracts";
import { Button } from "@fan-support/ui";
import type { ManagementApi, ManagementSection } from "./api";
import type { OrdersApi } from "../management-orders/api";
import type { PaymentConfigurationApi } from "../management-payments/api";
import { PaymentsWorkspace } from "../management-payments/workspace";
import type { FinanceApi } from "../management-finance/api";
import { OrdersWorkspace } from "../management-orders/workspace";
import { ordersCopy } from "../management-orders/copy";
import { ManagementWorkspace } from "./workspace";
import { ManagementShell } from "./shell";
import { ManagementLogout } from "./logout";
import { managementCopy } from "./copy";
import { resolveManagementAccess } from "./access";
export function ManagementHub({
  api,
  ordersApi,
  financeApi,
  paymentsApi,
  locale,
  storefrontOrigin,
  onLogout,
}: {
  api: ManagementApi;
  ordersApi: OrdersApi;
  financeApi?: FinanceApi | undefined;
  paymentsApi?: PaymentConfigurationApi | undefined;
  locale: SupportedLocale;
  storefrontOrigin?: string | undefined;
  onLogout?: (() => Promise<void>) | undefined;
}) {
  const [access, setAccess] = useState<ReturnType<
    typeof resolveManagementAccess
  > | null>(null);
  const [attempt, setAttempt] = useState(0),
    [section, setSection] = useState<
      ManagementSection | "ORDERS" | "PAYMENTS" | null
    >(null),
    [busy, setBusy] = useState(false);
  const copy = ordersCopy(locale),
    common = managementCopy(locale);
  useEffect(() => {
    let canceled = false;
    setAccess(null);
    void Promise.allSettled([
      api.context(),
      ordersApi.context(),
      paymentsApi?.read() ?? Promise.resolve(null),
    ] as const).then(([content, orders, payments]) => {
      if (!canceled)
        setAccess(
          resolveManagementAccess(
            content,
            orders,
            payments.status === "rejected"
              ? payments
              : payments.value
                ? { status: "fulfilled", value: payments.value }
                : undefined,
          ),
        );
    });
    return () => {
      canceled = true;
    };
  }, [api, ordersApi, paymentsApi, attempt]);
  const active =
    section ??
    (access?.contentAllowed
      ? "ARTISTS"
      : access?.payments
        ? "PAYMENTS"
        : "ORDERS");
  function chooseSection(next: ManagementSection | "ORDERS" | "PAYMENTS") {
    setSection(next);
    if (next === "PAYMENTS") setAttempt((value) => value + 1);
  }
  const retry = (
    <Button
      type="button"
      variant="secondary"
      data-workspace-access-retry
      disabled={busy}
      onClick={() => setAttempt((value) => value + 1)}
    >
      {common.retry}
    </Button>
  );
  const notice = access?.temporaryFailure ? (
    <div className="mc-error-state" role="alert">
      <p>{copy.loadError}</p>
      {retry}
    </div>
  ) : null;
  if (access?.contentAllowed && active !== "ORDERS" && active !== "PAYMENTS")
    return (
      <ManagementWorkspace
        api={api}
        locale={locale}
        storefrontOrigin={storefrontOrigin}
        onLogout={onLogout}
        initialSection={active}
        onOrders={access.orders ? () => setSection("ORDERS") : undefined}
        onPayments={
          access.payments ? () => chooseSection("PAYMENTS") : undefined
        }
        accessNotice={notice}
      />
    );
  return (
    <ManagementShell
      locale={locale}
      section={active}
      contentAllowed={access?.contentAllowed ?? false}
      ordersAvailable={Boolean(access?.orders)}
      paymentsAvailable={Boolean(access?.payments)}
      disabled={busy || !access}
      onSection={chooseSection}
      accountAction={
        onLogout ? (
          <ManagementLogout
            locale={locale}
            onLogout={onLogout}
            disabled={busy}
          />
        ) : undefined
      }
    >
      {notice}
      {active === "PAYMENTS" && access?.payments && paymentsApi ? (
        <PaymentsWorkspace
          api={paymentsApi}
          initial={access.payments}
          locale={locale}
          onBusy={setBusy}
        />
      ) : access?.orders ? (
        <OrdersWorkspace
          api={ordersApi}
          financeApi={financeApi}
          context={access.orders}
          locale={locale}
          onBusy={setBusy}
        />
      ) : (
        <>
          <h1>{common.center}</h1>
          <div className="mc-empty">
            <p role={access ? "alert" : "status"}>
              {!access
                ? common.checkingSession
                : access.temporaryFailure
                  ? copy.loadError
                  : copy.noAccess}
            </p>
            {access && !access.temporaryFailure ? retry : null}
          </div>
        </>
      )}
    </ManagementShell>
  );
}
