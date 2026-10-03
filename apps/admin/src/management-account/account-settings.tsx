"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Field } from "@fan-support/ui";
import type { SupportedLocale } from "@fan-support/contracts";
import { signInCopy } from "../management-center/local-sign-in-copy";
import {
  codeFromInput,
  newPasswordProblem,
} from "../management-center/local-sign-in-model";
import { accountCopy } from "./copy";
import type { AccountApi, AccountView, TotpEnrollment } from "./api";
import { accountFailure, groupedKey, recoveryCodesFile } from "./model";
import { QrCode } from "./qr-code";
import "./account.css";

// ADR-021 / L3-10 ⑤: the signed-in account's password and two-step verification.
export type TwoFactorMode =
  "IDLE" | "UNLOCK" | "SCAN" | "CODES" | "REGENERATE" | "DISABLE";
type Message = Readonly<{ text: string; tone: "error" | "done" }>;

function Notice({ message }: { message: Message | null }) {
  if (!message) return null;
  return (
    <p
      className={`account-message account-message--${message.tone}`}
      role={message.tone === "error" ? "alert" : "status"}
    >
      {message.text}
    </p>
  );
}
function formatted(locale: SupportedLocale, value: string, time = false) {
  return new Intl.DateTimeFormat(
    locale,
    time ? { timeStyle: "short" } : { dateStyle: "medium", timeStyle: "short" },
  ).format(new Date(value));
}

export function AccountSettings({
  api,
  locale,
  account,
  onAccount,
  onReload,
  initial,
}: {
  api: AccountApi;
  locale: SupportedLocale;
  account: AccountView;
  onAccount: (account: AccountView) => void;
  onReload: () => void;
  /** Rendering a later state directly is for tests only. */
  initial?: Readonly<{
    mode: TwoFactorMode;
    enrollment?: TotpEnrollment;
    codes?: readonly string[];
  }>;
}) {
  const copy = accountCopy(locale);
  return (
    <div className="account-page" data-account-settings>
      <div className="account-heading">
        <h1>{copy.title}</h1>
        <p className="account-meta">
          {copy.loginName.replace("{account}", account.loginName)}
        </p>
      </div>
      {account.twoFactorEnabled ? null : (
        <p className="account-banner" data-two-factor-warning>
          {copy.warningBanner}
        </p>
      )}
      <PasswordSection
        api={api}
        locale={locale}
        account={account}
        onAccount={onAccount}
        onReload={onReload}
      />
      <TwoFactorSection
        api={api}
        locale={locale}
        account={account}
        onAccount={onAccount}
        onReload={onReload}
        initial={initial}
      />
    </div>
  );
}

function PasswordSection({
  api,
  locale,
  account,
  onAccount,
  onReload,
}: {
  api: AccountApi;
  locale: SupportedLocale;
  account: AccountView;
  onAccount: (account: AccountView) => void;
  onReload: () => void;
}) {
  const copy = accountCopy(locale),
    signIn = signInCopy(locale);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!current)
      return setMessage({ text: copy.invalidPassword, tone: "error" });
    const problem =
      newPasswordProblem(next, confirmation, account.loginName) ??
      (next.normalize("NFC") === current.normalize("NFC")
        ? "sameAsCurrent"
        : null);
    if (problem) return setMessage({ text: signIn[problem], tone: "error" });
    setBusy(true);
    setMessage(null);
    try {
      onAccount(await api.changePassword(current, next));
      setCurrent("");
      setNext("");
      setConfirmation("");
      setRevealed(false);
      setMessage({ text: copy.passwordChanged, tone: "done" });
    } catch (error) {
      const failure = accountFailure(error, locale);
      setMessage({ text: failure.message, tone: "error" });
      if (failure.reload) onReload();
    } finally {
      setBusy(false);
    }
  }
  const type = revealed ? "text" : "password";
  const invalid = message?.tone === "error" || undefined;
  return (
    <section className="account-section" aria-labelledby="account-password">
      <h2 id="account-password">{copy.passwordTitle}</h2>
      <p className="account-meta">
        {copy.passwordChangedOn.replace(
          "{date}",
          formatted(locale, account.passwordChangedAt),
        )}
      </p>
      <form className="account-form" noValidate onSubmit={submit}>
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={account.loginName}
          readOnly
          hidden
        />
        <Field
          id="account-current-password"
          type={type}
          label={copy.currentPassword}
          autoComplete="current-password"
          value={current}
          aria-invalid={invalid}
          onChange={(event) => setCurrent(event.currentTarget.value)}
        />
        <Field
          id="account-new-password"
          type={type}
          label={signIn.newPassword}
          hint={signIn.passwordHint}
          autoComplete="new-password"
          value={next}
          aria-invalid={invalid}
          onChange={(event) => setNext(event.currentTarget.value)}
        />
        <Field
          id="account-confirm-password"
          type={type}
          label={signIn.confirmPassword}
          autoComplete="new-password"
          value={confirmation}
          aria-invalid={invalid}
          onChange={(event) => setConfirmation(event.currentTarget.value)}
        />
        <Button
          type="button"
          variant="quiet"
          size="compact"
          className="account-quiet"
          aria-pressed={revealed}
          onClick={() => setRevealed((value) => !value)}
        >
          {revealed ? signIn.hidePassword : signIn.showPassword}
        </Button>
        <Notice message={message} />
        <Button type="submit" loading={busy} className="account-submit">
          {busy ? copy.changingPassword : copy.changePassword}
        </Button>
      </form>
    </section>
  );
}

function TwoFactorSection({
  api,
  locale,
  account,
  onAccount,
  onReload,
  initial,
}: {
  api: AccountApi;
  locale: SupportedLocale;
  account: AccountView;
  onAccount: (account: AccountView) => void;
  onReload: () => void;
  initial?:
    | Readonly<{
        mode: TwoFactorMode;
        enrollment?: TotpEnrollment;
        codes?: readonly string[];
      }>
    | undefined;
}) {
  const copy = accountCopy(locale),
    signIn = signInCopy(locale);
  const [mode, setMode] = useState<TwoFactorMode>(initial?.mode ?? "IDLE");
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(
    initial?.enrollment ?? null,
  );
  const [codes, setCodes] = useState<readonly string[]>(initial?.codes ?? []);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const first = useRef<HTMLInputElement>(null);
  const codesHeading = useRef<HTMLHeadingElement>(null);
  const opened = useRef(false);
  // Each opened step starts in its first field; the new codes are announced by moving focus to them.
  useEffect(() => {
    if (!opened.current) {
      opened.current = true;
      return;
    }
    if (mode === "CODES") codesHeading.current?.focus();
    else first.current?.focus();
  }, [mode]);
  function open(next: TwoFactorMode) {
    setMode(next);
    setPassword("");
    setCode("");
    setMessage(null);
  }
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch (error) {
      const failure = accountFailure(error, locale);
      setMessage({ text: failure.message, tone: "error" });
      if (failure.restartSetup) {
        setEnrollment(null);
        setMode("IDLE");
      }
      if (failure.reload) onReload();
    } finally {
      setBusy(false);
    }
  }
  function currentCode(): string | null {
    const value = codeFromInput("TOTP", code);
    if (value === null) setMessage({ text: signIn.codeFormat, tone: "error" });
    return value;
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (mode === "UNLOCK")
      return void run(async () => {
        setEnrollment(await api.beginTotp(password));
        setPassword("");
        setMode("SCAN");
      });
    const value = currentCode();
    if (value === null) return;
    if (mode === "SCAN")
      return void run(async () => {
        const result = await api.confirmTotp(value);
        onAccount(result.account);
        setCodes(result.recoveryCodes);
        setEnrollment(null);
        setMode("CODES");
        setMessage({ text: copy.turnedOn, tone: "done" });
      });
    if (mode === "REGENERATE")
      return void run(async () => {
        const result = await api.regenerateRecoveryCodes(password, value);
        onAccount(result.account);
        setCodes(result.recoveryCodes);
        setMode("CODES");
      });
    return void run(async () => {
      onAccount(await api.disableTotp(password, value));
      setMode("IDLE");
      setMessage({ text: copy.turnedOff, tone: "done" });
    });
  }
  function download() {
    const file = new Blob(
      [recoveryCodesFile(locale, account.loginName, codes, new Date())],
      { type: "text/plain;charset=utf-8" },
    );
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = `recovery-codes-${account.loginName}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }
  const invalid = message?.tone === "error" || undefined;
  // Label while idle, label while the request runs.
  const actions: Readonly<
    Record<Exclude<TwoFactorMode, "IDLE" | "CODES">, readonly [string, string]>
  > = {
    UNLOCK: [copy.continue, copy.checking],
    SCAN: [copy.turnOn, copy.turningOn],
    REGENERATE: [copy.getNewCodes, copy.checking],
    DISABLE: [copy.turnOff, copy.turningOff],
  };
  const cancel = (
    <Button
      type="button"
      variant="quiet"
      className="account-quiet"
      disabled={busy}
      onClick={() => {
        setEnrollment(null);
        open("IDLE");
      }}
    >
      {copy.cancel}
    </Button>
  );
  const passwordField = (
    <Field
      ref={first}
      id="account-2fa-password"
      type="password"
      label={copy.currentPassword}
      autoComplete="current-password"
      value={password}
      aria-invalid={invalid}
      onChange={(event) => setPassword(event.currentTarget.value)}
    />
  );
  const codeField = (withFocus: boolean) => (
    <Field
      ref={withFocus ? first : undefined}
      id="account-2fa-code"
      label={signIn.codeLabel}
      autoComplete="one-time-code"
      inputMode="numeric"
      autoCapitalize="none"
      spellCheck={false}
      maxLength={7}
      className="si-code"
      value={code}
      aria-invalid={invalid}
      onChange={(event) => setCode(event.currentTarget.value)}
    />
  );
  return (
    <section className="account-section" aria-labelledby="account-2fa">
      <h2 id="account-2fa">{copy.twoFactorTitle}</h2>
      <p
        className="account-status"
        data-two-factor={account.twoFactorEnabled ? "on" : "off"}
      >
        {account.twoFactorEnabled ? copy.twoFactorOn : copy.twoFactorOff}
      </p>
      {mode === "IDLE" ? (
        <>
          {account.twoFactorEnabled ? (
            <p className="account-meta">
              {copy.remaining.replace(
                "{count}",
                String(account.recoveryCodesRemaining),
              )}
            </p>
          ) : null}
          <Notice message={message} />
          <div className="account-actions">
            {account.twoFactorEnabled ? (
              <>
                <Button variant="secondary" onClick={() => open("REGENERATE")}>
                  {copy.newCodes}
                </Button>
                <Button variant="quiet" onClick={() => open("DISABLE")}>
                  {copy.turnOff}
                </Button>
              </>
            ) : (
              <Button onClick={() => open("UNLOCK")}>{copy.setUp}</Button>
            )}
          </div>
        </>
      ) : null}
      {mode === "CODES" ? (
        <div className="account-codes">
          <Notice message={message} />
          <h3 ref={codesHeading} tabIndex={-1}>
            {copy.recoveryTitle}
          </h3>
          <p className="account-meta">{copy.recoveryIntro}</p>
          <ul className="account-code-list">
            {codes.map((value) => (
              <li key={value}>{value}</li>
            ))}
          </ul>
          <div className="account-actions">
            <Button variant="secondary" onClick={download}>
              {copy.download}
            </Button>
            <Button
              onClick={() => {
                setCodes([]);
                open("IDLE");
              }}
            >
              {copy.saved}
            </Button>
          </div>
        </div>
      ) : null}
      {mode === "UNLOCK" ||
      mode === "SCAN" ||
      mode === "REGENERATE" ||
      mode === "DISABLE" ? (
        <form
          className={`account-form${mode === "SCAN" ? " account-form--wide" : ""}`}
          noValidate
          onSubmit={submit}
        >
          {mode === "UNLOCK" ? (
            <>
              <p className="account-meta">{copy.setUpPrompt}</p>
              {passwordField}
            </>
          ) : null}
          {mode === "SCAN" && enrollment ? (
            <div className="account-enroll">
              <QrCode value={enrollment.otpauthUri} label={copy.qrLabel} />
              <div className="account-enroll-text">
                <p>{copy.scanIntro}</p>
                <p className="account-meta">{copy.manualKey}</p>
                <p className="account-key" data-totp-key>
                  {groupedKey(enrollment.secret)}
                </p>
                <p className="account-meta">
                  {copy.setUpExpires.replace(
                    "{time}",
                    formatted(locale, enrollment.expiresAt, true),
                  )}
                </p>
                {codeField(true)}
              </div>
            </div>
          ) : null}
          {mode === "REGENERATE" || mode === "DISABLE" ? (
            <>
              <p className="account-meta">
                {mode === "REGENERATE" ? copy.newCodesIntro : copy.turnOffIntro}
              </p>
              {passwordField}
              {codeField(false)}
            </>
          ) : null}
          <Notice message={message} />
          <div className="account-actions">
            <Button
              type="submit"
              loading={busy}
              variant={mode === "DISABLE" ? "danger" : "primary"}
            >
              {actions[mode][busy ? 1 : 0]}
            </Button>
            {cancel}
          </div>
        </form>
      ) : null}
    </section>
  );
}
