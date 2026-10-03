"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Field } from "@fan-support/ui";
import {
  LOCALE_NATIVE_NAMES,
  SUPPORTED_LOCALES,
  type AdminLocalAccessBrowserResponse,
  type SupportedLocale,
} from "@fan-support/contracts";
import { managementCopy } from "./copy";
import { signInCopy } from "./local-sign-in-copy";
import { submitSignIn } from "./local-sign-in-api";
import {
  codeFromInput,
  failureMessage,
  newPasswordProblem,
  type SignInFactor,
  type SignInMessage,
} from "./local-sign-in-model";
import "./local-sign-in.css";

// ADR-021 / L3-10 ④: the formal sign-in page for built-in accounts.
export type SignInStep = "PASSWORD" | "SECOND_FACTOR" | "NEW_PASSWORD";

export function LocalSignIn({
  locale,
  expired = false,
  onSignedIn,
  initial,
  submit = submitSignIn,
}: {
  locale: SupportedLocale;
  expired?: boolean;
  onSignedIn: () => void;
  /** Rendering a later step directly is for tests and previews only. */
  initial?: Readonly<{
    step: SignInStep;
    factor?: SignInFactor;
    loginName?: string;
  }>;
  submit?: typeof submitSignIn;
}) {
  const copy = signInCopy(locale);
  const center = managementCopy(locale);
  const [step, setStep] = useState<SignInStep>(initial?.step ?? "PASSWORD");
  const [factor, setFactor] = useState<SignInFactor>(initial?.factor ?? "TOTP");
  const [loginName, setLoginName] = useState(initial?.loginName ?? "");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<SignInMessage | null>(null);
  const first = useRef<HTMLInputElement>(null);
  // A single-purpose page: the cursor starts in the first field of every step.
  useEffect(() => {
    first.current?.focus();
  }, [step, factor]);

  function goTo(next: SignInStep, error: SignInMessage | null = null) {
    setStep(next);
    setMessage(error);
    setPassword("");
    setCode("");
    setNewPassword("");
    setConfirmation("");
    setRevealed(false);
    if (next === "SECOND_FACTOR") setFactor("TOTP");
  }
  function settle(response: AdminLocalAccessBrowserResponse) {
    if (response.outcome === "SUCCESS") {
      if (response.kind === "SIGNED_IN") {
        onSignedIn();
        return;
      }
      goTo(response.step);
      return;
    }
    const outcome = failureMessage(response, factor);
    if (outcome.restart) goTo("PASSWORD", outcome.message);
    else setMessage(outcome.message);
  }
  async function send(action: "login" | "step", body: unknown) {
    setBusy(true);
    try {
      settle(await submit(action, body));
    } finally {
      setBusy(false);
    }
  }
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (step === "PASSWORD") {
      const name = loginName.trim().toLowerCase();
      if (!name || !password) return setMessage("invalidCredentials");
      setLoginName(name);
      void send("login", {
        schemaVersion: 1,
        locale,
        loginName: name,
        password,
      });
      return;
    }
    if (step === "SECOND_FACTOR") {
      const value = codeFromInput(factor, code);
      if (value === null)
        return setMessage(factor === "TOTP" ? "codeFormat" : "invalidRecovery");
      void send("step", {
        schemaVersion: 1,
        step: { kind: factor, code: value },
      });
      return;
    }
    const problem = newPasswordProblem(newPassword, confirmation, loginName);
    if (problem) return setMessage(problem);
    void send("step", {
      schemaVersion: 1,
      step: { kind: "NEW_PASSWORD", newPassword },
    });
  }

  const account = (text: string) => text.replace("{account}", loginName);
  const title =
    step === "PASSWORD"
      ? copy.signInTitle
      : step === "NEW_PASSWORD"
        ? copy.newPasswordTitle
        : factor === "TOTP"
          ? copy.codeTitle
          : copy.recoveryTitle;
  const intro =
    step === "PASSWORD"
      ? copy.signInIntro
      : step === "NEW_PASSWORD"
        ? account(copy.newPasswordIntro)
        : factor === "TOTP"
          ? account(copy.codeIntro)
          : copy.recoveryIntro;
  const [action, pending] =
    step === "PASSWORD"
      ? [copy.signIn, copy.signingIn]
      : step === "NEW_PASSWORD"
        ? [copy.savePassword, copy.saving]
        : [copy.verify, copy.verifying];
  const invalid = message !== null || undefined;
  const described = message ? "si-message" : undefined;
  const reveal = (
    <Button
      type="button"
      variant="quiet"
      size="compact"
      className="si-reveal"
      aria-pressed={revealed}
      onClick={() => setRevealed((value) => !value)}
    >
      {revealed ? copy.hidePassword : copy.showPassword}
    </Button>
  );
  return (
    <div className="si-page" data-local-sign-in={step}>
      <header className="si-plaque">
        <p className="si-wordmark">{center.center}</p>
        <p className="si-tagline">{copy.tagline}</p>
      </header>
      <main className="si-panel" id="management-main">
        <form className="si-form" noValidate onSubmit={onSubmit}>
          <h1>{title}</h1>
          <p className="si-intro">{intro}</p>
          {expired && step === "PASSWORD" && message === null ? (
            <p className="si-note" role="status">
              {center.sessionExpired}
            </p>
          ) : null}
          {step === "PASSWORD" ? (
            <>
              <Field
                ref={first}
                id="si-login-name"
                name="username"
                label={copy.loginName}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={loginName}
                aria-invalid={invalid}
                aria-describedby={described}
                onChange={(event) => setLoginName(event.currentTarget.value)}
              />
              <Field
                id="si-password"
                name="password"
                type={revealed ? "text" : "password"}
                label={copy.password}
                autoComplete="current-password"
                required
                value={password}
                aria-invalid={invalid}
                aria-describedby={described}
                onChange={(event) => setPassword(event.currentTarget.value)}
              />
              {reveal}
            </>
          ) : null}
          {step === "SECOND_FACTOR" ? (
            <Field
              ref={first}
              key={factor}
              id="si-code"
              name="code"
              label={factor === "TOTP" ? copy.codeLabel : copy.recoveryLabel}
              autoComplete={factor === "TOTP" ? "one-time-code" : "off"}
              inputMode={factor === "TOTP" ? "numeric" : "text"}
              autoCapitalize={factor === "TOTP" ? "none" : "characters"}
              spellCheck={false}
              maxLength={factor === "TOTP" ? 7 : 32}
              required
              className={factor === "TOTP" ? "si-code" : undefined}
              value={code}
              aria-invalid={invalid}
              aria-describedby={described}
              onChange={(event) => setCode(event.currentTarget.value)}
            />
          ) : null}
          {step === "NEW_PASSWORD" ? (
            <>
              {/* Lets password managers file the new password under this account. */}
              <input
                type="text"
                name="username"
                autoComplete="username"
                value={loginName}
                readOnly
                hidden
              />
              <Field
                ref={first}
                id="si-new-password"
                name="new-password"
                type={revealed ? "text" : "password"}
                label={copy.newPassword}
                hint={copy.passwordHint}
                autoComplete="new-password"
                required
                value={newPassword}
                aria-invalid={invalid}
                aria-describedby={described}
                onChange={(event) => setNewPassword(event.currentTarget.value)}
              />
              <Field
                id="si-confirm-password"
                name="confirm-password"
                type={revealed ? "text" : "password"}
                label={copy.confirmPassword}
                autoComplete="new-password"
                required
                value={confirmation}
                aria-invalid={invalid}
                aria-describedby={described}
                onChange={(event) => setConfirmation(event.currentTarget.value)}
              />
              {reveal}
            </>
          ) : null}
          {message ? (
            <p className="si-message" id="si-message" role="alert">
              {copy[message]}
            </p>
          ) : null}
          <Button type="submit" className="si-submit" loading={busy}>
            {busy ? pending : action}
          </Button>
          {step === "SECOND_FACTOR" ? (
            <Button
              type="button"
              variant="quiet"
              className="si-switch"
              disabled={busy}
              onClick={() => {
                setFactor(factor === "TOTP" ? "RECOVERY_CODE" : "TOTP");
                setCode("");
                setMessage(null);
              }}
            >
              {factor === "TOTP" ? copy.useRecovery : copy.useAuthenticator}
            </Button>
          ) : null}
          {step !== "PASSWORD" ? (
            <Button
              type="button"
              variant="quiet"
              className="si-switch"
              disabled={busy}
              onClick={() => goTo("PASSWORD")}
            >
              {copy.differentAccount}
            </Button>
          ) : null}
        </form>
        <label className="si-language mc-field">
          <span>{center.interfaceLanguage}</span>
          <select
            data-management-language
            value={locale}
            disabled={busy}
            onChange={(event) => {
              if (event.currentTarget.value !== locale)
                window.location.assign(`/${event.currentTarget.value}`);
            }}
          >
            {SUPPORTED_LOCALES.map((value) => (
              <option key={value} value={value}>
                {LOCALE_NATIVE_NAMES[value]}
              </option>
            ))}
          </select>
        </label>
      </main>
    </div>
  );
}
