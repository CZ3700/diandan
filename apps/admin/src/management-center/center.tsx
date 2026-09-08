"use client";
import { useMemo } from "react";
import { Button } from "@fan-support/ui";
import type { SupportedLocale } from "@fan-support/contracts";
import { useAdminSession } from "../workspace/client";
import { createManagementApi } from "./api";
import { managementCopy } from "./copy";
import { ManagementShell } from "./shell";
import { ManagementWorkspace } from "./workspace";
import "./management-center.css";

export function ManagementCenter({
  locale,
  storefrontOrigin,
}: {
  locale: SupportedLocale;
  storefrontOrigin?: string | undefined;
}) {
  const { client, session, loading, reload } = useAdminSession();
  const api = useMemo(() => createManagementApi(client), [client]);
  const copy = managementCopy(locale);
  if (loading || !session)
    return (
      <ManagementShell
        locale={locale}
        section="ARTISTS"
        disabled
        onSection={() => {}}
      >
        <h1>{copy.artists}</h1>
        <div className="mc-empty">
          <p role={loading ? "status" : "alert"}>
            {loading ? copy.checkingSession : copy.sessionMissing}
          </p>
          {!loading ? (
            <Button type="button" onClick={reload}>
              {copy.reconnect}
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
    />
  );
}
