"use client";
import { useRef, useState } from "react";
import { Button } from "@fan-support/ui";
import type { SupportedLocale } from "@fan-support/contracts";
import { managementCopy } from "./copy";

export function ManagementLogout({
  locale,
  onLogout,
  disabled,
}: {
  locale: SupportedLocale;
  onLogout: () => Promise<void>;
  disabled: boolean;
}) {
  const copy = managementCopy(locale);
  const active = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function logout() {
    if (disabled || active.current) return;
    active.current = true;
    setBusy(true);
    setFailed(false);
    try {
      await onLogout();
    } catch {
      setFailed(true);
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="mc-account">
      <Button
        variant="quiet"
        type="button"
        disabled={disabled || busy}
        loading={busy}
        onClick={() => void logout()}
      >
        {copy.logout}
      </Button>
      {failed ? (
        <p className="mc-error" role="alert">
          {copy.logoutFailed}
        </p>
      ) : null}
    </div>
  );
}
