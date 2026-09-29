"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Button, Field } from "@fan-support/ui";
import type { SupportedLocale } from "@fan-support/contracts";
import { signInCopy } from "../management-center/local-sign-in-copy";
import { staffCopy } from "./copy";
import type { StaffApi, StaffMember, StaffRole } from "./api";
import {
  OPERATOR_ROLE,
  displayNameFromInput,
  loginNameFromInput,
  roleLabel,
  staffFailure,
  type StaffAction,
} from "./model";
import "./staff.css";

// ADR-021 / L3-10 ⑥: staff accounts for holders of staff.manage.
type Panel =
  | Readonly<{ kind: "CREATE" }>
  | Readonly<{ kind: "ROLES"; accountId: string }>
  | Readonly<{
      kind: "CONFIRM";
      accountId: string;
      action: "RESET_PASSWORD" | "CLEAR_TOTP" | "SUSPEND";
    }>
  | Readonly<{ kind: "TEMPORARY"; loginName: string; password: string }>;
type Notice = Readonly<{ text: string; tone: "error" | "done" }>;
type Listing = Readonly<{
  members: readonly StaffMember[];
  roles: readonly StaffRole[];
}>;

export function StaffWorkspace({
  api,
  locale,
  onBusy,
  initial,
}: {
  api: StaffApi;
  locale: SupportedLocale;
  onBusy?: (busy: boolean) => void;
  /** Rendering a listing or panel directly is for tests only. */
  initial?: Readonly<{ listing: Listing; panel?: Panel }>;
}) {
  const copy = staffCopy(locale);
  const [listing, setListing] = useState<Listing | null>(
    initial?.listing ?? null,
  );
  const [loadFailed, setLoadFailed] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(initial?.panel ?? null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setListing(await api.list());
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [api]);
  useEffect(() => {
    if (!initial) void load();
  }, [initial, load]);
  useEffect(() => onBusy?.(busy), [busy, onBusy]);
  function replace(member: StaffMember) {
    setListing((current) =>
      current
        ? {
            ...current,
            members: current.members.map((value) =>
              value.accountId === member.accountId ? member : value,
            ),
          }
        : current,
    );
  }
  async function run(action: StaffAction, work: () => Promise<void>) {
    setBusy(true);
    setNotice(null);
    try {
      await work();
    } catch (error) {
      const failure = staffFailure(error, locale, action);
      setNotice({ text: failure.message, tone: "error" });
      if (failure.reload) {
        setPanel(null);
        await load();
      }
    } finally {
      setBusy(false);
    }
  }
  if (!listing)
    return (
      <div className="staff-page" data-staff-workspace>
        <h1>{copy.title}</h1>
        {loadFailed ? (
          <div className="mc-error-state" role="alert">
            <p>{copy.loadFailed}</p>
            <Button variant="secondary" onClick={() => void load()}>
              {copy.retry}
            </Button>
          </div>
        ) : null}
      </div>
    );
  return (
    <div className="staff-page" data-staff-workspace>
      <div className="staff-heading">
        <div>
          <h1>{copy.title}</h1>
          <p className="staff-meta">{copy.intro}</p>
        </div>
        <Button
          disabled={busy || panel?.kind === "CREATE"}
          onClick={() => {
            setNotice(null);
            setPanel({ kind: "CREATE" });
          }}
        >
          {copy.create}
        </Button>
      </div>
      {notice ? (
        <p
          className={`staff-notice staff-notice--${notice.tone}`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      ) : null}
      {panel?.kind === "TEMPORARY" ? (
        <TemporaryPassword
          locale={locale}
          loginName={panel.loginName}
          password={panel.password}
          onDone={() => setPanel(null)}
        />
      ) : null}
      {panel?.kind === "CREATE" ? (
        <CreateStaff
          locale={locale}
          roles={listing.roles}
          busy={busy}
          onCancel={() => setPanel(null)}
          onCreate={(input) =>
            run("CREATE", async () => {
              const created = await api.create(input);
              setListing({
                ...listing,
                members: [...listing.members, created.member],
              });
              setPanel({
                kind: "TEMPORARY",
                loginName: created.member.loginName,
                password: created.temporaryPassword,
              });
            })
          }
          onInvalid={(text) => setNotice({ text, tone: "error" })}
        />
      ) : null}
      <ul className="staff-list">
        {listing.members.map((member) => (
          <StaffRow
            key={member.accountId}
            locale={locale}
            member={member}
            roles={listing.roles}
            panel={
              panel &&
              (panel.kind === "ROLES" || panel.kind === "CONFIRM") &&
              panel.accountId === member.accountId
                ? panel
                : null
            }
            busy={busy}
            onPanel={(next) => {
              setNotice(null);
              setPanel(next);
            }}
            onRoles={(roleKeys) =>
              run("UPDATE_ROLES", async () => {
                replace(await api.updateRoles(member, roleKeys));
                setPanel(null);
                setNotice({ text: copy.saved, tone: "done" });
              })
            }
            onConfirm={(action) =>
              run(action === "SUSPEND" ? "SET_STATUS" : action, async () => {
                if (action === "RESET_PASSWORD") {
                  const reset = await api.resetPassword(member);
                  replace(reset.member);
                  setPanel({
                    kind: "TEMPORARY",
                    loginName: reset.member.loginName,
                    password: reset.temporaryPassword,
                  });
                  return;
                }
                replace(
                  action === "CLEAR_TOTP"
                    ? await api.clearTwoFactor(member)
                    : await api.setStatus(member, "SUSPENDED"),
                );
                setPanel(null);
                setNotice({ text: copy.saved, tone: "done" });
              })
            }
            onReactivate={() =>
              run("SET_STATUS", async () => {
                replace(await api.setStatus(member, "ACTIVE"));
                setNotice({ text: copy.saved, tone: "done" });
              })
            }
          />
        ))}
      </ul>
    </div>
  );
}

function RoleChoices({
  locale,
  roles,
  selected,
  onChange,
  legend,
}: {
  locale: SupportedLocale;
  roles: readonly StaffRole[];
  selected: readonly string[];
  onChange: (next: readonly string[]) => void;
  legend: string;
}) {
  return (
    <fieldset className="staff-roles">
      <legend>{legend}</legend>
      {roles.map((role) => {
        const label = roleLabel(role, locale);
        const id = `staff-role-${role.roleKey.replace(/[^a-z0-9]/gu, "-")}`;
        return (
          <label key={role.roleKey} className="staff-role" htmlFor={id}>
            <input
              id={id}
              type="checkbox"
              checked={selected.includes(role.roleKey)}
              onChange={(event) =>
                onChange(
                  event.currentTarget.checked
                    ? [...selected, role.roleKey]
                    : selected.filter((key) => key !== role.roleKey),
                )
              }
            />
            <span>
              <strong>{label.name}</strong>
              <span className="staff-meta">{label.detail}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

function CreateStaff({
  locale,
  roles,
  busy,
  onCreate,
  onCancel,
  onInvalid,
}: {
  locale: SupportedLocale;
  roles: readonly StaffRole[];
  busy: boolean;
  onCreate: (
    input: Readonly<{
      loginName: string;
      displayName: string;
      roleKeys: readonly string[];
    }>,
  ) => void;
  onCancel: () => void;
  onInvalid: (message: string) => void;
}) {
  const copy = staffCopy(locale);
  const [loginName, setLoginName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [roleKeys, setRoleKeys] = useState<readonly string[]>(
    roles.some((role) => role.roleKey === OPERATOR_ROLE) ? [OPERATOR_ROLE] : [],
  );
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const name = loginNameFromInput(loginName);
    const shown = displayNameFromInput(displayName);
    if (name === null) return onInvalid(copy.invalidLoginName);
    if (shown === null) return onInvalid(copy.invalidDisplayName);
    if (roleKeys.length === 0) return onInvalid(copy.noRole);
    onCreate({ loginName: name, displayName: shown, roleKeys });
  }
  return (
    <form className="staff-panel" noValidate onSubmit={submit}>
      <h2>{copy.create}</h2>
      <Field
        ref={first}
        id="staff-login-name"
        label={signInCopy(locale).loginName}
        hint={copy.loginNameHint}
        autoCapitalize="none"
        autoComplete="off"
        spellCheck={false}
        value={loginName}
        onChange={(event) => setLoginName(event.currentTarget.value)}
      />
      <Field
        id="staff-display-name"
        label={copy.displayName}
        autoComplete="off"
        value={displayName}
        onChange={(event) => setDisplayName(event.currentTarget.value)}
      />
      <RoleChoices
        locale={locale}
        roles={roles}
        selected={roleKeys}
        onChange={setRoleKeys}
        legend={copy.roles}
      />
      <div className="staff-actions">
        <Button type="submit" loading={busy}>
          {busy ? copy.creating : copy.createAction}
        </Button>
        <Button
          type="button"
          variant="quiet"
          disabled={busy}
          onClick={onCancel}
        >
          {copy.cancel}
        </Button>
      </div>
    </form>
  );
}

function TemporaryPassword({
  locale,
  loginName,
  password,
  onDone,
}: {
  locale: SupportedLocale;
  loginName: string;
  password: string;
  onDone: () => void;
}) {
  const copy = staffCopy(locale);
  const [copied, setCopied] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <section
      className="staff-panel staff-temporary"
      aria-labelledby="staff-temporary"
    >
      <h2 id="staff-temporary" ref={heading} tabIndex={-1}>
        {copy.temporaryTitle.replace("{account}", loginName)}
      </h2>
      <p className="staff-meta">{copy.temporaryIntro}</p>
      <p className="staff-password" data-temporary-password>
        {password}
      </p>
      <div className="staff-actions">
        <Button
          variant="secondary"
          onClick={() =>
            void navigator.clipboard
              .writeText(password)
              .then(() => setCopied(true))
              .catch(() => setCopied(false))
          }
        >
          {copied ? copy.copied : copy.copy}
        </Button>
        <Button onClick={onDone}>{copy.done}</Button>
      </div>
    </section>
  );
}

function StaffRow({
  locale,
  member,
  roles,
  panel,
  busy,
  onPanel,
  onRoles,
  onConfirm,
  onReactivate,
}: {
  locale: SupportedLocale;
  member: StaffMember;
  roles: readonly StaffRole[];
  panel: Extract<Panel, { kind: "ROLES" | "CONFIRM" }> | null;
  busy: boolean;
  onPanel: (panel: Panel | null) => void;
  onRoles: (roleKeys: readonly string[]) => void;
  onConfirm: (action: "RESET_PASSWORD" | "CLEAR_TOTP" | "SUSPEND") => void;
  onReactivate: () => void;
}) {
  const copy = staffCopy(locale);
  const [selected, setSelected] = useState<readonly string[]>(member.roleKeys);
  const confirmText = {
    RESET_PASSWORD: copy.confirmReset,
    CLEAR_TOTP: copy.confirmClear,
    SUSPEND: copy.confirmSuspend,
  };
  const roleNames = new Intl.ListFormat(locale, { type: "unit" }).format(
    member.roleKeys.map(
      (key) =>
        roleLabel(
          roles.find((role) => role.roleKey === key) ?? {
            roleKey: key,
            description: key,
          },
          locale,
        ).name,
    ),
  );
  const nameId = `staff-name-${member.accountId}`;
  return (
    <li
      className="staff-row"
      data-staff-member={member.loginName}
      aria-labelledby={nameId}
    >
      <div className="staff-who">
        <p className="staff-name" id={nameId}>
          {member.displayName}
          {member.self ? <span className="staff-you">{copy.you}</span> : null}
        </p>
        <p className="staff-meta">{member.loginName}</p>
      </div>
      <ul className="staff-facts">
        <li data-status={member.status}>
          {member.status === "ACTIVE" ? copy.active : copy.suspended}
        </li>
        <li data-two-factor={member.twoFactorEnabled ? "on" : "off"}>
          {member.twoFactorEnabled ? copy.twoFactorOn : copy.twoFactorOff}
        </li>
        {member.mustChangePassword ? <li>{copy.mustChange}</li> : null}
        <li>{roleNames}</li>
        <li>
          {member.lastLoginAt
            ? copy.lastSignIn.replace(
                "{date}",
                new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(member.lastLoginAt)),
              )
            : copy.never}
        </li>
      </ul>
      <div className="staff-actions">
        <Button
          size="compact"
          variant="secondary"
          disabled={busy}
          onClick={() => {
            setSelected(member.roleKeys);
            onPanel({ kind: "ROLES", accountId: member.accountId });
          }}
        >
          {copy.changeRoles}
        </Button>
        {member.self ? null : (
          <>
            <Button
              size="compact"
              variant="quiet"
              disabled={busy}
              onClick={() =>
                onPanel({
                  kind: "CONFIRM",
                  accountId: member.accountId,
                  action: "RESET_PASSWORD",
                })
              }
            >
              {copy.resetPassword}
            </Button>
            {member.twoFactorEnabled ? (
              <Button
                size="compact"
                variant="quiet"
                disabled={busy}
                onClick={() =>
                  onPanel({
                    kind: "CONFIRM",
                    accountId: member.accountId,
                    action: "CLEAR_TOTP",
                  })
                }
              >
                {copy.clearTwoFactor}
              </Button>
            ) : null}
            {member.status === "ACTIVE" ? (
              <Button
                size="compact"
                variant="quiet"
                disabled={busy}
                onClick={() =>
                  onPanel({
                    kind: "CONFIRM",
                    accountId: member.accountId,
                    action: "SUSPEND",
                  })
                }
              >
                {copy.suspend}
              </Button>
            ) : (
              <Button
                size="compact"
                variant="quiet"
                disabled={busy}
                onClick={onReactivate}
              >
                {copy.reactivate}
              </Button>
            )}
          </>
        )}
      </div>
      {panel?.kind === "ROLES" ? (
        <form
          className="staff-panel"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) onRoles(selected);
          }}
        >
          <RoleChoices
            locale={locale}
            roles={roles}
            selected={selected}
            onChange={setSelected}
            legend={copy.roles}
          />
          <div className="staff-actions">
            <Button
              type="submit"
              loading={busy}
              disabled={selected.length === 0}
            >
              {busy ? copy.working : copy.saveRoles}
            </Button>
            <Button
              type="button"
              variant="quiet"
              disabled={busy}
              onClick={() => onPanel(null)}
            >
              {copy.cancel}
            </Button>
          </div>
        </form>
      ) : null}
      {panel?.kind === "CONFIRM" ? (
        <div
          className="staff-panel"
          role="group"
          aria-labelledby={`${nameId}-confirm`}
        >
          <p id={`${nameId}-confirm`}>
            {confirmText[panel.action].replace("{account}", member.loginName)}
          </p>
          <div className="staff-actions">
            <Button
              variant={panel.action === "RESET_PASSWORD" ? "primary" : "danger"}
              loading={busy}
              onClick={() => onConfirm(panel.action)}
            >
              {busy ? copy.working : copy.confirm}
            </Button>
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => onPanel(null)}
            >
              {copy.cancel}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
