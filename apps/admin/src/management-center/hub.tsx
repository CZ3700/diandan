"use client";
import { useEffect, useState } from "react";
import type {
  AdminSessionPermission,
  SupportedLocale,
} from "@fan-support/contracts";
import { Button } from "@fan-support/ui";
import { InformationPagesWorkspace } from "../management-info-pages/workspace";
import type { InformationPagesApi } from "../management-info-pages/api";
import type { PoliciesApi } from "../management-policies/api";
import { PoliciesWorkspace } from "../management-policies/workspace";
import type { AccountApi, AccountView } from "../management-account/api";
import { AccountSettings } from "../management-account/account-settings";
import { accountCopy } from "../management-account/copy";
import type { StaffApi } from "../management-staff/api";
import { StaffWorkspace } from "../management-staff/staff-workspace";
import type { ManagementApi, ManagementSection } from "./api";
import type { OrdersApi } from "../management-orders/api";
import type { PaymentConfigurationApi } from "../management-payments/api";
import { PaymentsWorkspace } from "../management-payments/workspace";
import type { ExceptionsApi } from "../management-exceptions/api";
import { ExceptionsWorkspace } from "../management-exceptions/workspace";
import type { FinanceApi } from "../management-finance/api";
import { OrdersWorkspace } from "../management-orders/workspace";
import { ordersCopy } from "../management-orders/copy";
import type { LedgerApi } from "../management-ledger/api";
import { LedgerWorkspace } from "../management-ledger/workspace";
import { ManagementWorkspace } from "./workspace";
import { ManagementShell } from "./shell";
import { PageManagement } from "./page-management";
import { ManagementLogout } from "./logout";
import { managementCopy } from "./copy";
import type { HomeLayoutApi } from "../management-decoration/api";
import { DecorationCenter } from "../management-decoration/center";
import type { StorefrontNavigationApi } from "../management-decoration/navigation-api";
import type { DisplayOrderApi } from "../management-decoration/display-order-api";
import type { StorefrontBrandApi } from "../management-decoration/brand-api";
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
  ledgerApi,
  paymentsApi,
  exceptionsApi,
  layoutApi,
  themeApi,
  brandApi,
  canUploadBrand = false,
  navigationApi,
  displayOrderApi,
  layoutPermissions,
  infoPagesApi,
  infoPagesAccess,
  policiesApi,
  policiesAccess,
  accountApi,
  staffApi,
  locale,
  storefrontOrigin,
  onLogout,
  canDeleteArtists = false,
}: {
  api: ManagementApi;
  ordersApi: OrdersApi;
  financeApi?: FinanceApi | undefined;
  ledgerApi?: LedgerApi | undefined;
  paymentsApi?: PaymentConfigurationApi | undefined;
  exceptionsApi?: ExceptionsApi | undefined;
  layoutApi?: HomeLayoutApi | undefined;
  themeApi?: StorefrontThemeApi | undefined;
  brandApi?: StorefrontBrandApi | undefined;
  canUploadBrand?: boolean;
  navigationApi?: StorefrontNavigationApi | undefined;
  displayOrderApi?: DisplayOrderApi | undefined;
  infoPagesApi?: InformationPagesApi | undefined;
  policiesApi?: PoliciesApi | undefined;
  policiesAccess?:
    | {
        allowed: boolean;
        localeScopes: readonly SupportedLocale[];
        permissions: readonly AdminSessionPermission[];
        actorId: string;
      }
    | undefined;
  accountApi?: AccountApi | undefined;
  staffApi?: StaffApi | undefined;
  infoPagesAccess?:
    { allowed: boolean; localeScopes: readonly SupportedLocale[] } | undefined;
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
      | "INFO_PAGES"
      | "POLICIES"
      | "STAFF"
      | "ACCOUNT"
      | "LEDGER"
      | null
    >(null),
    [busy, setBusy] = useState(false);
  const [layoutDirty, setLayoutDirty] = useState(false);
  const [infoDirty, setInfoDirty] = useState(false);
  const [paymentDirty, setPaymentDirty] = useState(false);
  const copy = ordersCopy(locale),
    common = managementCopy(locale);
  // Null until known, and for identity-provider sessions, which have no built-in settings.
  const [account, setAccount] = useState<AccountView | null>(null);
  const [accountRead, setAccountRead] = useState(0);
  useEffect(() => {
    if (!accountApi) return;
    let canceled = false;
    void accountApi.context().then(
      (value) => {
        if (!canceled) setAccount(value);
      },
      () => {
        if (!canceled) setAccount(null);
      },
    );
    return () => {
      canceled = true;
    };
  }, [accountApi, accountRead]);
  const [staffAvailable, setStaffAvailable] = useState(false);
  useEffect(() => {
    if (!staffApi) return;
    let canceled = false;
    void staffApi.available().then(
      (value) => {
        if (!canceled) setStaffAvailable(value);
      },
      () => {
        if (!canceled) setStaffAvailable(false);
      },
    );
    return () => {
      canceled = true;
    };
  }, [staffApi]);
  const accountWarning =
    account && !account.twoFactorEnabled
      ? accountCopy(locale).warningBadge
      : undefined;
  useEffect(() => {
    let canceled = false;
    setAccess(null);
    void Promise.allSettled([
      api.context(),
      ordersApi.context(),
      paymentsApi?.read() ?? Promise.resolve(null),
      exceptionsApi?.context() ?? Promise.resolve(null),
      ledgerApi?.context() ?? Promise.resolve(null),
    ] as const).then(([content, orders, payments, exceptions, ledger]) => {
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
            ledger.status === "rejected"
              ? ledger
              : ledger.value
                ? { status: "fulfilled", value: ledger.value }
                : undefined,
          ),
        );
    });
    return () => {
      canceled = true;
    };
  }, [api, ordersApi, paymentsApi, exceptionsApi, ledgerApi, attempt]);
  function defaultSection(): NonNullable<typeof section> {
    if (access?.contentAllowed) return "ARTISTS";
    if (infoPagesAccess?.allowed && infoPagesApi) return "INFO_PAGES";
    if (policiesAccess?.allowed && policiesApi) return "POLICIES";
    if (access?.payments) return "PAYMENTS";
    if (access?.orders) return "ORDERS";
    if (access?.ledger) return "LEDGER";
    return "EXCEPTIONS";
  }
  const active = section ?? defaultSection();
  function canLeaveWorkspace() {
    return canLeaveDecoration(
      { busy, dirty: layoutDirty || paymentDirty || infoDirty },
      () =>
        window.confirm(
          layoutDirty
            ? decorationNavigationCopy(locale).discard
            : common.discardEdits,
        ),
    );
  }
  const logout = onLogout
    ? async () => {
        if (canLeaveWorkspace()) await onLogout();
      }
    : undefined;
  function chooseSection(
    next:
      | ManagementSection
      | "ORDERS"
      | "PAYMENTS"
      | "EXCEPTIONS"
      | "DECORATION"
      | "INFO_PAGES"
      | "POLICIES"
      | "STAFF"
      | "ACCOUNT"
      | "LEDGER",
  ) {
    if (next !== active && !canLeaveWorkspace()) return;
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
    active !== "DECORATION" &&
    active !== "INFO_PAGES" &&
    active !== "POLICIES" &&
    active !== "STAFF" &&
    active !== "ACCOUNT" &&
    managementSectionUnavailable(access, active) ? (
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
    active !== "INFO_PAGES" &&
    active !== "POLICIES" &&
    active !== "EXCEPTIONS" &&
    active !== "STAFF" &&
    active !== "ACCOUNT" &&
    active !== "LEDGER"
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
        onInfoPages={
          infoPagesAccess?.allowed && infoPagesApi
            ? () => chooseSection("INFO_PAGES")
            : undefined
        }
        onPolicies={
          policiesAccess?.allowed && policiesApi
            ? () => chooseSection("POLICIES")
            : undefined
        }
        onDecoration={
          layoutPermissions?.read && layoutApi
            ? () => chooseSection("DECORATION")
            : undefined
        }
        onStaff={staffAvailable ? () => chooseSection("STAFF") : undefined}
        onAccount={account ? () => chooseSection("ACCOUNT") : undefined}
        onLedger={
          access.ledger && !access.orders
            ? () => chooseSection("LEDGER")
            : undefined
        }
        accountWarning={accountWarning}
        accessNotice={notice}
        canDeleteArtists={canDeleteArtists}
        artistsOnly={access.artistsOnly}
      />
    );
  return (
    <ManagementShell
      locale={locale}
      section={active}
      contentAllowed={access?.contentAllowed ?? false}
      artistsOnly={access?.artistsOnly ?? false}
      ordersAvailable={Boolean(access?.orders)}
      ledgerAvailable={Boolean(access?.ledger && !access.orders)}
      paymentsAvailable={Boolean(access?.payments)}
      exceptionsAvailable={Boolean(access?.exceptions)}
      infoPagesAvailable={Boolean(infoPagesAccess?.allowed && infoPagesApi)}
      policiesAvailable={Boolean(policiesAccess?.allowed && policiesApi)}
      decorationAvailable={Boolean(layoutPermissions?.read && layoutApi)}
      staffAvailable={staffAvailable}
      accountAvailable={Boolean(account)}
      accountWarning={accountWarning}
      beforeLeave={canLeaveWorkspace}
      disabled={busy || !access}
      onSection={chooseSection}
      accountAction={
        logout ? (
          <ManagementLogout locale={locale} onLogout={logout} disabled={busy} />
        ) : undefined
      }
    >
      {notice}
      {active === "STAFF" && staffAvailable && staffApi ? (
        <StaffWorkspace api={staffApi} locale={locale} onBusy={setBusy} />
      ) : active === "ACCOUNT" && account && accountApi ? (
        <AccountSettings
          api={accountApi}
          locale={locale}
          account={account}
          onAccount={setAccount}
          onReload={() => setAccountRead((value) => value + 1)}
        />
      ) : (active === "INFO_PAGES" || active === "POLICIES") &&
        ((active === "INFO_PAGES" &&
          infoPagesAccess?.allowed &&
          infoPagesApi) ||
          (active === "POLICIES" && policiesAccess?.allowed && policiesApi)) ? (
        <PageManagement
          locale={locale}
          active={active}
          infoPagesAvailable={Boolean(infoPagesAccess?.allowed && infoPagesApi)}
          policiesAvailable={Boolean(policiesAccess?.allowed && policiesApi)}
          busy={busy}
          onSection={chooseSection}
        >
          {active === "INFO_PAGES" && infoPagesAccess && infoPagesApi ? (
            <InformationPagesWorkspace
              api={infoPagesApi}
              locale={locale}
              localeScopes={infoPagesAccess.localeScopes}
              storefrontOrigin={storefrontOrigin}
              onBusy={setBusy}
              onDirtyChange={setInfoDirty}
              embedded
            />
          ) : policiesAccess && policiesApi ? (
            <PoliciesWorkspace
              api={policiesApi}
              locale={locale}
              localeScopes={policiesAccess.localeScopes}
              permissions={policiesAccess.permissions}
              actorId={policiesAccess.actorId}
              onBusy={setBusy}
              onDirtyChange={setInfoDirty}
              embedded
            />
          ) : null}
        </PageManagement>
      ) : active === "DECORATION" && layoutPermissions?.read && layoutApi ? (
        <DecorationCenter
          api={layoutApi}
          themeApi={themeApi}
          brandApi={brandApi}
          canUploadBrand={canUploadBrand}
          navigationApi={navigationApi}
          displayOrderApi={displayOrderApi}
          locale={locale}
          storefrontOrigin={storefrontOrigin}
          canEdit={layoutPermissions.edit}
          canPublish={layoutPermissions.publish}
          onBusy={setBusy}
          onDirtyChange={setLayoutDirty}
        />
      ) : active === "LEDGER" && access?.ledger && ledgerApi ? (
        <LedgerWorkspace
          api={ledgerApi}
          context={access.ledger}
          locale={locale}
          onBusy={setBusy}
          standalone
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
          onDirtyChange={setPaymentDirty}
          initial={access.payments}
          locale={locale}
          onBusy={setBusy}
        />
      ) : access?.orders ? (
        <OrdersWorkspace
          api={ordersApi}
          financeApi={financeApi}
          ledgerApi={access.ledger && ledgerApi ? ledgerApi : undefined}
          ledgerContext={access.ledger ?? undefined}
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
