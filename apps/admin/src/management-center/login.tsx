"use client";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@fan-support/ui";
import type { SupportedLocale } from "@fan-support/contracts";
import { requestAdminLogin } from "../workspace/client";
import { managementCopy } from "./copy";

export function ManagementLogin({
  locale,
  onFailure,
}: {
  locale: SupportedLocale;
  onFailure: () => void;
}) {
  const active = useRef(false);
  const [busy, setBusy] = useState(false);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current) return;
    active.current = true;
    setBusy(true);
    try {
      // Same-origin fetch retains Origin even under the page's no-referrer policy.
      // Only the public authorization URL reaches JavaScript; the binding is HttpOnly.
      const authorizationUrl = await requestAdminLogin(locale);
      window.location.assign(authorizationUrl);
    } catch {
      active.current = false;
      setBusy(false);
      onFailure();
    }
  }
  return (
    <form
      method="post"
      action="/api/admin/auth/begin"
      onSubmit={(event) => void login(event)}
    >
      <input type="hidden" name="locale" value={locale} />
      <Button type="submit" disabled={busy} loading={busy}>
        {managementCopy(locale).login}
      </Button>
    </form>
  );
}
