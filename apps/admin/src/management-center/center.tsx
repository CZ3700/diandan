"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@fan-support/ui";
import type { SupportedLocale } from "@fan-support/contracts";
import { useAdminSession } from "../workspace/client";
import { createManagementApi } from "./api";
import { managementCopy } from "./copy";
import { ManagementShell } from "./shell";
import { ManagementWorkspace } from "./workspace";
import { ManagementLogin } from "./login";
import "./management-center.css";

export function ManagementCenter({
  locale,
  storefrontOrigin,
  authenticationAvailable = false,
}: {
  locale: SupportedLocale;
  storefrontOrigin?: string | undefined;
  authenticationAvailable?: boolean;
}) {
  const { client, session, loading, reload, unavailable, expired, logout } =
    useAdminSession();
  const api = useMemo(() => createManagementApi(client), [client]);
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
  if (loading || !session)
    return (
      <ManagementShell
        locale={locale}
        section="ARTISTS"
        disabled
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
    <ManagementWorkspace
      api={api}
      locale={locale}
      storefrontOrigin={storefrontOrigin}
      onLogout={authenticationAvailable ? logout : undefined}
    />
  );
}
