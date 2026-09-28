"use client";
import { useEffect, useState } from "react";
import type { SupportedLocale } from "@fan-support/contracts";
import { Button } from "@fan-support/ui";
import type { ManagementApi, ManagementSection } from "./api";
import type { OrdersApi } from "../management-orders/api";
import type { PaymentConfigurationApi } from "../management-payments/api";
import { PaymentsWorkspace } from "../management-payments/workspace";
import type { ExceptionsApi } from "../management-exceptions/api";
import { ExceptionsWorkspace } from "../management-exceptions/workspace";
import type { FinanceApi } from "../management-finance/api";
import { OrdersWorkspace } from "../management-orders/workspace";
import { ordersCopy } from "../management-orders/copy";
import { ManagementWorkspace } from "./workspace";
import { ManagementShell } from "./shell";
import { ManagementLogout } from "./logout";
import { managementCopy } from "./copy";
import type { HomeLayoutApi } from "../management-decoration/api";
import { DecorationCenter } from "../management-decoration/center";
import type { StorefrontThemeApi } from "../management-decoration/theme-api";
import { canLeaveDecoration } from "../management-decoration/navigation";
import { decorationNavigationCopy } from "../management-decoration/theme-copy";
import {
  resolveManagementAccess,
  managementSectionUnavailable,
} from "./access";
export function ManagementHub({
  api,
  ordersApi,
  financeApi,
  paymentsApi,
  exceptionsApi,
  layoutApi,
  themeApi,
  layoutPermissions,
  locale,
  storefrontOrigin,
  onLogout,
  canDeleteArtists = false,
}: {
  api: ManagementApi;
  ordersApi: OrdersApi;
  financeApi?: FinanceApi | undefined;
  paymentsApi?: PaymentConfigurationApi | undefined;
  exceptionsApi?: ExceptionsApi | undefined;
  layoutApi?: HomeLayoutApi | undefined;
  themeApi?: StorefrontThemeApi | undefined;
  layoutPermissions?:
    { read: boolean; edit: boolean; publish: boolean } | undefined;
  locale: SupportedLocale;
  storefrontOrigin?: string | undefined;
  onLogout?: (() => Promise<void>) | undefined;
  canDeleteArtists?: boolean;
}) {
  const [access, setAccess] = useState<ReturnType<
    typeof resolveManagementAccess
  > | null>(null);
  const [attempt, setAttempt] = useState(0),
    [section, setSection] = useState<
      | ManagementSection
      | "ORDERS"
      | "PAYMENTS"
      | "EXCEPTIONS"
      | "DECORATION"
      | null
    >(null),
    [busy, setBusy] = useState(false);
  const [layoutDirty, setLayoutDirty] = useState(false);
  const copy = ordersCopy(locale),
    common = managementCopy(locale);
  useEffect(() => {
    let canceled = false;
    setAccess(null);
    void Promise.allSettled([
      api.context(),
      ordersApi.context(),
      paymentsApi?.read() ?? Promise.resolve(null),
      exceptionsApi?.context() ?? Promise.resolve(null),
    ] as const).then(([content, orders, payments, exceptions]) => {
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
            exceptions.status === "rejected"
              ? exceptions
              : exceptions.value
                ? { status: "fulfilled", value: exceptions.value }
                : undefined,
          ),
        );
    });
    return () => {
      canceled = true;
    };
  }, [api, ordersApi, paymentsApi, exceptionsApi, attempt]);
  const active =
    section ??
    (access?.contentAllowed
      ? "ARTISTS"
      : access?.payments
        ? "PAYMENTS"
        : access?.orders
          ? "ORDERS"
          : "EXCEPTIONS");
  function canLeaveLayout() {
    return canLeaveDecoration({ busy, dirty: layoutDirty }, () =>
      window.confirm(decorationNavigationCopy(locale).discard),
    );
  }
  const logout = onLogout
    ? async () => {
        if (canLeaveLayout()) await onLogout();
      }
    : undefined;
  function chooseSection(
    next:
      ManagementSection | "ORDERS" | "PAYMENTS" | "EXCEPTIONS" | "DECORATION",
  ) {
    if (next !== "DECORATION" && !canLeaveLayout()) return;
    setSection(next);
    if (next === "PAYMENTS" || next === "EXCEPTIONS")
      setAttempt((value) => value + 1);
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
  const notice =
    active !== "DECORATION" && managementSectionUnavailable(access, active) ? (
      <div className="mc-error-state" role="alert">
        <p>{copy.loadError}</p>
        {retry}
      </div>
    ) : null;
  if (
    access?.contentAllowed &&
    active !== "ORDERS" &&
    active !== "PAYMENTS" &&
    active !== "DECORATION" &&
    active !== "EXCEPTIONS"
  )
    return (
      <ManagementWorkspace
        api={api}
        locale={locale}
        storefrontOrigin={storefrontOrigin}
        onLogout={logout}
        initialSection={active}
        onOrders={access.orders ? () => setSection("ORDERS") : undefined}
        onPayments={
          access.payments ? () => chooseSection("PAYMENTS") : undefined
        }
        onExceptions={
          access.exceptions ? () => chooseSection("EXCEPTIONS") : undefined
        }
        onDecoration={
          layoutPermissions?.read && layoutApi
            ? () => chooseSection("DECORATION")
            : undefined
        }
        accessNotice={notice}
        canDeleteArtists={canDeleteArtists}
      />
    );
  return (
    <ManagementShell
      locale={locale}
      section={active}
      contentAllowed={access?.contentAllowed ?? false}
      ordersAvailable={Boolean(access?.orders)}
      paymentsAvailable={Boolean(access?.payments)}
      exceptionsAvailable={Boolean(access?.exceptions)}
      decorationAvailable={Boolean(layoutPermissions?.read && layoutApi)}
      disabled={busy || !access}
      onSection={chooseSection}
      accountAction={
        logout ? (
          <ManagementLogout locale={locale} onLogout={logout} disabled={busy} />
        ) : undefined
      }
    >
      {notice}
      {active === "DECORATION" && layoutPermissions?.read && layoutApi ? (
        <DecorationCenter
          api={layoutApi}
          themeApi={themeApi}
          locale={locale}
          storefrontOrigin={storefrontOrigin}
          canEdit={layoutPermissions.edit}
          canPublish={layoutPermissions.publish}
          onBusy={setBusy}
          onDirtyChange={setLayoutDirty}
        />
      ) : active === "EXCEPTIONS" && access?.exceptions && exceptionsApi ? (
        <ExceptionsWorkspace
          api={exceptionsApi}
          initial={access.exceptions}
          locale={locale}
          onBusy={setBusy}
        />
      ) : active === "PAYMENTS" && access?.payments && paymentsApi ? (
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
