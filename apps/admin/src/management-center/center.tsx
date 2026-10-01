"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@fan-support/ui";
import {
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "@fan-support/contracts";
import { useAdminSession } from "../workspace/client";
import { createManagementApi } from "./api";
import { managementCopy } from "./copy";
import { ManagementShell } from "./shell";
import { ManagementHub } from "./hub";
import { createOrdersApi } from "../management-orders/api";
import { createPaymentConfigurationApi } from "../management-payments/api";
import { createExceptionsApi } from "../management-exceptions/api";
import { createFinanceApi } from "../management-finance/api";
import { createLedgerApi } from "../management-ledger/api";
import { ManagementLogin } from "./login";
import { LocalSignIn } from "./local-sign-in";
import "./management-center.css";
import { createHomeLayoutApi } from "../management-decoration/api";
import { createStorefrontNavigationApi } from "../management-decoration/navigation-api";
import { createDisplayOrderApi } from "../management-decoration/display-order-api";
import { createInformationPagesApi } from "../management-info-pages/api";
import { createAccountApi } from "../management-account/api";
import { createStaffApi } from "../management-staff/api";
import { createStorefrontBrandApi } from "../management-decoration/brand-api";
import { createStorefrontThemeApi } from "../management-decoration/theme-api";

export function ManagementCenter({
  locale,
  storefrontOrigin,
  authenticationAvailable = false,
  localAccounts = false,
}: {
  locale: SupportedLocale;
  storefrontOrigin?: string | undefined;
  authenticationAvailable?: boolean;
  /** ADR-021 built-in accounts sign in on their own page instead of an identity provider. */
  localAccounts?: boolean;
}) {
  const { client, session, loading, reload, unavailable, expired, logout } =
    useAdminSession();
  const api = useMemo(() => createManagementApi(client), [client]);
  const ordersApi = useMemo(() => createOrdersApi(client), [client]);
  const paymentsApi = useMemo(
    () => createPaymentConfigurationApi(client),
    [client],
  );
  const exceptionsApi = useMemo(() => createExceptionsApi(client), [client]);
  const financeApi = useMemo(() => createFinanceApi(client), [client]);
  const ledgerApi = useMemo(() => createLedgerApi(client), [client]);
  const layoutApi = useMemo(() => createHomeLayoutApi(client), [client]);
  const navigationApi = useMemo(
    () => createStorefrontNavigationApi(client),
    [client],
  );
  const displayOrderApi = useMemo(
    () => createDisplayOrderApi(client),
    [client],
  );
  const infoPagesApi = useMemo(
    () => createInformationPagesApi(client),
    [client],
  );
  const brandApi = useMemo(() => createStorefrontBrandApi(client), [client]);
  const themeApi = useMemo(() => createStorefrontThemeApi(client), [client]);
  const accountApi = useMemo(() => createAccountApi(client), [client]);
  const staffApi = useMemo(() => createStaffApi(client), [client]);
  const copy = managementCopy(locale);
  const [loginFailed, setLoginFailed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (authenticationAvailable && url.searchParams.get("login") === "failed") {
      setLoginFailed(true);
      window.history.replaceState(window.history.state, "", url.pathname);
    }
  }, [authenticationAvailable]);
  useEffect(() => {
    if (authenticationAvailable && !loading && !session)
      heading.current?.focus();
  }, [authenticationAvailable, loading, session]);
  let sessionMessage = copy.loginHint;
  if (loading) sessionMessage = copy.checkingSession;
  else if (!authenticationAvailable) sessionMessage = copy.sessionMissing;
  else if (unavailable) sessionMessage = copy.sessionUnavailable;
  else if (loginFailed) sessionMessage = copy.loginFailed;
  else if (expired) sessionMessage = copy.sessionExpired;

  const canLogin = authenticationAvailable && !unavailable;
  if (localAccounts && canLogin && !loading && !session)
    return (
      <LocalSignIn locale={locale} expired={expired} onSignedIn={reload} />
    );
  if (loading || !session)
    return (
      <ManagementShell
        locale={locale}
        section="ARTISTS"
        disabled
        languageDisabled={loading}
        onSection={() => {}}
      >
        <h1 ref={heading} tabIndex={-1}>
          {authenticationAvailable ? copy.center : copy.artists}
        </h1>
        <div className="mc-empty">
          <p role={loading ? "status" : "alert"}>{sessionMessage}</p>
          {!loading && canLogin ? (
            <ManagementLogin
              locale={locale}
              onFailure={() => setLoginFailed(true)}
            />
          ) : null}
          {!loading && !canLogin ? (
            <Button type="button" onClick={reload}>
              {authenticationAvailable ? copy.retry : copy.reconnect}
            </Button>
          ) : null}
        </div>
      </ManagementShell>
    );
  return (
    <ManagementHub
      api={api}
      ordersApi={ordersApi}
      financeApi={financeApi}
      ledgerApi={ledgerApi}
      paymentsApi={paymentsApi}
      exceptionsApi={exceptionsApi}
      layoutApi={layoutApi}
      themeApi={themeApi}
      brandApi={brandApi}
      canUploadBrand={(
        [
          "content.edit",
          "content.media.upload",
          "content.media.rights",
        ] as const
      ).every((permission) => session.permissions.includes(permission))}
      navigationApi={navigationApi}
      displayOrderApi={displayOrderApi}
      infoPagesApi={infoPagesApi}
      accountApi={localAccounts ? accountApi : undefined}
      staffApi={localAccounts ? staffApi : undefined}
      infoPagesAccess={{
        allowed: session.permissions.includes("content.read"),
        localeScopes: session.localeScopes,
      }}
      layoutPermissions={{
        read: session.permissions.includes("content.read"),
        edit: session.permissions.includes("content.edit"),
        publish: session.permissions.includes("content.publish"),
      }}
      locale={locale}
      storefrontOrigin={storefrontOrigin}
      onLogout={authenticationAvailable ? logout : undefined}
      canDeleteArtists={
        // Artist identity status writes need content.edit in every published locale.
        session.permissions.includes("content.edit") &&
        SUPPORTED_LOCALES.every((value) => session.localeScopes.includes(value))
      }
    />
  );
}
