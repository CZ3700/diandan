"use client";
import { useEffect, useState } from "react";
import type { SupportedLocale } from "@fan-support/contracts";
import { Button } from "@fan-support/ui";
import type { ManagementApi, ManagementSection } from "./api";
import type { OrdersApi } from "../management-orders/api";
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
  locale,
  storefrontOrigin,
  onLogout,
}: {
  api: ManagementApi;
  ordersApi: OrdersApi;
  financeApi?: FinanceApi | undefined;
  locale: SupportedLocale;
  storefrontOrigin?: string | undefined;
  onLogout?: (() => Promise<void>) | undefined;
}) {
  const [access, setAccess] = useState<ReturnType<
    typeof resolveManagementAccess
  > | null>(null);
  const [attempt, setAttempt] = useState(0),
    [section, setSection] = useState<ManagementSection | "ORDERS" | null>(null),
    [busy, setBusy] = useState(false);
  const copy = ordersCopy(locale),
    common = managementCopy(locale);
  useEffect(() => {
    let canceled = false;
    setAccess(null);
    void Promise.allSettled([api.context(), ordersApi.context()]).then(
      ([content, orders]) => {
        if (!canceled) setAccess(resolveManagementAccess(content, orders));
      },
    );
    return () => {
      canceled = true;
    };
  }, [api, ordersApi, attempt]);
  const active = section ?? (access?.contentAllowed ? "ARTISTS" : "ORDERS");
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
  if (access?.contentAllowed && active !== "ORDERS")
    return (
      <ManagementWorkspace
        api={api}
        locale={locale}
        storefrontOrigin={storefrontOrigin}
        onLogout={onLogout}
        initialSection={active}
        onOrders={access.orders ? () => setSection("ORDERS") : undefined}
        accessNotice={notice}
      />
    );
  return (
    <ManagementShell
      locale={locale}
      section={active}
      contentAllowed={access?.contentAllowed ?? false}
      ordersAvailable={Boolean(access?.orders)}
      disabled={busy || !access}
      onSection={setSection}
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
      {access?.orders ? (
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
