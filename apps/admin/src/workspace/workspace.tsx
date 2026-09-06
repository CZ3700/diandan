"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Field } from "@fan-support/ui";
import {
  adminCatalogResponseSchema,
  type AdminCatalogOwner,
  type ContentAuthoringTarget,
  type SupportedLocale,
} from "@fan-support/contracts";
import { useAdminSession } from "./client";
import { ContentEditor } from "./editor";
import {
  LocaleSelect,
  Select,
  Status,
  errorText,
  translator,
} from "./components";
import { ownerKey } from "./catalog-picker";
import { MediaUpload } from "./media-tools";
export function AdminWorkspace({ locale }: { locale: SupportedLocale }) {
  const { client, session, loading, reload } = useAdminSession();
  const t = useMemo(() => translator(locale), [locale]);
  const [section, setSection] = useState<
    "artists" | "homepage" | "media" | "translations"
  >("artists");
  const [kind, setKind] = useState<ContentAuthoringTarget["kind"]>("IDOL");
  const [items, setItems] = useState<AdminCatalogOwner[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<AdminCatalogOwner | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [creating, setCreating] = useState(false);
  const [handle, setHandle] = useState("");
  const onDirty = useCallback((value: boolean) => setDirty(value), []);
  const contentLocale = session?.localeScopes.includes(locale)
    ? locale
    : (session?.localeScopes[0] ?? locale);
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  useEffect(() => {
    if (!session) return;
    let active = true;
    setBusy(true);
    setError("");
    void client
      .call(
        "catalog-list",
        {
          schemaVersion: 1,
          kind,
          locale: contentLocale,
          page,
          pageSize: 12,
          ...(query ? { q: query } : {}),
          ...(status ? { status } : {}),
        },
        adminCatalogResponseSchema,
      )
      .then((result) => {
        if (active && result.kind === "OWNERS") {
          setItems(result.items);
          setTotal(result.totalItems);
        }
      })
      .catch((e: unknown) => {
        if (active) setError(errorText(e, t));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [client, session, kind, contentLocale, page, query, status, refresh, t]);
  const canLeave = () => !dirty || window.confirm(t("discard"));
  const refreshSelected = () => {
    setRefresh((value) => value + 1);
    if (selected)
      void client
        .call(
          "catalog-owner",
          { schemaVersion: 1, target: selected.target, locale: contentLocale },
          adminCatalogResponseSchema,
        )
        .then((result) => {
          if (result.kind === "OWNER")
            setSelected((current) =>
              current &&
              ownerKey(current.target) === ownerKey(result.owner.target)
                ? { ...result.owner, target: current.target }
                : current,
            );
        })
        .catch((e: unknown) => setError(errorText(e, t)));
  };
  const choose = (owner: AdminCatalogOwner) => {
    if (!canLeave()) return;
    setCreating(false);
    setSelected(owner);
    setDirty(false);
  };
  const switchSection = (value: typeof section) => {
    if (!canLeave()) return;
    setSection(value);
    setKind(
      value === "homepage"
        ? "HOMEPAGE"
        : value === "media"
          ? "MEDIA_METADATA"
          : "IDOL",
    );
    setSelected(null);
    setPage(1);
    setQuery("");
    setInput("");
    setStatus("");
    setCreating(false);
    setDirty(false);
  };
  const createArtist = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await client.call(
        "idol-create",
        {
          schemaVersion: 1,
          handle,
          expectedBaseVersion: 0,
          reasonCode: "ARTIST_CREATE",
        },
        adminCatalogResponseSchema,
        true,
      );
      if (result.kind !== "MUTATION") return;
      const read = await client.call(
        "catalog-owner",
        {
          schemaVersion: 1,
          target: { kind: "IDOL", idolId: result.idolId },
          locale: contentLocale,
        },
        adminCatalogResponseSchema,
      );
      if (read.kind === "OWNER") {
        choose(read.owner);
        setRefresh((value) => value + 1);
      }
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };
  if (loading)
    return (
      <main className="admin-auth">
        <p role="status">{t("loading")}</p>
      </main>
    );
  if (!session)
    return (
      <main className="admin-auth">
        <div>
          <span className="admin-eyebrow">{t("workspace")}</span>
          <h1>{t("sessionRequired")}</h1>
          <p>{t("sessionHint")}</p>
          <Button onClick={reload}>{t("reload")}</Button>
          <LocaleSelect
            label={t("language")}
            value={locale}
            onChange={(value) => window.location.assign(`/${value}`)}
          />
        </div>
      </main>
    );
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <a
          className="admin-wordmark"
          href={`/${locale}`}
          onClick={(event) => {
            if (!canLeave()) event.preventDefault();
          }}
        >
          {t("workspace")}
        </a>
        <nav aria-label={t("content")}>
          {(["artists", "homepage", "media", "translations"] as const).map(
            (item, index) => (
              <button
                type="button"
                key={item}
                aria-current={section === item ? "page" : undefined}
                onClick={() => switchSection(item)}
              >
                <span aria-hidden="true" className="admin-nav-index">
                  0{index + 1}
                </span>
                {t(item)}
              </button>
            ),
          )}
        </nav>
        <div className="admin-sidebar-footer">
          <LocaleSelect
            label={t("language")}
            value={locale}
            onChange={(value) => {
              if (canLeave()) window.location.assign(`/${value}`);
            }}
          />
          <small>{t("localPreview")}</small>
        </div>
      </aside>
      <main className="admin-main">
        {selected ? (
          <>
            <Button
              variant="quiet"
              onClick={() => {
                if (canLeave()) {
                  setSelected(null);
                  setDirty(false);
                }
              }}
            >
              ← {t(section)}
            </Button>
            <ContentEditor
              key={ownerKey(selected.target)}
              client={client}
              session={session}
              owner={selected}
              t={t}
              initialLocale={contentLocale}
              onDirty={onDirty}
              onRefresh={refreshSelected}
              onOpen={choose}
            />
          </>
        ) : (
          <>
            <header className="admin-page-heading">
              <div>
                <p className="admin-eyebrow">{t("workspace")}</p>
                <h1>{t(section)}</h1>
                <p>{t("workspaceHint")}</p>
              </div>
              {kind === "IDOL" &&
                session.permissions.includes("content.edit") && (
                  <Button onClick={() => setCreating(!creating)}>
                    {t("newArtist")}
                  </Button>
                )}
              {kind === "MEDIA_METADATA" &&
                session.permissions.includes("content.media.upload") && (
                  <Button onClick={() => setCreating(!creating)}>
                    {t("upload")}
                  </Button>
                )}
            </header>
            {creating && kind === "IDOL" && (
              <form
                className="admin-create"
                onSubmit={(event) => {
                  event.preventDefault();
                  void createArtist();
                }}
              >
                <Field
                  id="new-artist-handle"
                  label={t("handle")}
                  required
                  value={handle}
                  maxLength={80}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  onChange={(event) => setHandle(event.target.value)}
                />
                <div className="admin-actions">
                  <Button
                    type="submit"
                    disabled={busy || !handle}
                    loading={busy}
                  >
                    {t("newArtist")}
                  </Button>
                  <Button variant="quiet" onClick={() => setCreating(false)}>
                    {t("cancel")}
                  </Button>
                </div>
              </form>
            )}
            {creating && kind === "MEDIA_METADATA" && (
              <MediaUpload client={client} t={t} onComplete={choose} />
            )}
            <form
              className="admin-toolbar"
              onSubmit={(event) => {
                event.preventDefault();
                setPage(1);
                setQuery(input);
              }}
            >
              <Field
                id="catalog-search"
                label={t("search")}
                value={input}
                maxLength={160}
                onChange={(event) => setInput(event.target.value)}
              />
              <Button variant="secondary" type="submit" disabled={busy}>
                {t("searchAction")}
              </Button>
              {kind === "IDOL" && (
                <Select
                  label={t("status")}
                  value={status}
                  onChange={(value) => {
                    setStatus(value);
                    setPage(1);
                  }}
                >
                  <option value="">{t("all")}</option>
                  {(["draft", "active", "paused", "archived"] as const).map(
                    (value) => (
                      <option key={value} value={value}>
                        {t(value)}
                      </option>
                    ),
                  )}
                </Select>
              )}
              {section === "translations" && (
                <Select
                  label={t("content")}
                  value={kind}
                  onChange={(value) => {
                    setKind(value as typeof kind);
                    setPage(1);
                    setStatus("");
                  }}
                >
                  <option value="IDOL">{t("artists")}</option>
                  <option value="HOMEPAGE">{t("homepage")}</option>
                  <option value="MEDIA_METADATA">{t("media")}</option>
                </Select>
              )}
            </form>
            {error && (
              <p role="alert" className="admin-notice admin-error">
                {error}
                <Button
                  variant="quiet"
                  onClick={() => setRefresh((value) => value + 1)}
                >
                  {t("retry")}
                </Button>
              </p>
            )}
            <div
              className="admin-directory"
              aria-busy={busy}
              data-testid="content-directory"
            >
              {busy ? (
                <p role="status" className="admin-empty">
                  {t("loading")}
                </p>
              ) : !items.length ? (
                <p className="admin-empty">{t("empty")}</p>
              ) : (
                items.map((owner) => (
                  <button
                    type="button"
                    className="admin-directory-row"
                    key={ownerKey(owner.target)}
                    onClick={() => choose(owner)}
                  >
                    <span className="admin-avatar" aria-hidden="true">
                      {(owner.label ?? owner.handle ?? "•").slice(0, 1)}
                    </span>
                    <span className="admin-row-name">
                      <strong>
                        {owner.label ??
                          owner.handle ??
                          t(kind === "HOMEPAGE" ? "homepage" : "draft")}
                      </strong>
                      <small>
                        {owner.media
                          ? `${owner.media.width} × ${owner.media.height} · ${owner.media.mimeType}`
                          : (owner.handle ?? t("content"))}
                      </small>
                    </span>
                    <Status value={owner.status} t={t} />
                    <span className="admin-row-version">
                      {t("revision")} {owner.authoringVersion}
                    </span>
                    <span aria-hidden="true">↗</span>
                  </button>
                ))
              )}
            </div>
            <footer className="admin-pagination">
              <span>{t("items", { count: total })}</span>
              <div className="admin-actions">
                <Button
                  variant="quiet"
                  disabled={busy || page === 1}
                  onClick={() => setPage(page - 1)}
                >
                  {t("previous")}
                </Button>
                <span>{page}</span>
                <Button
                  variant="quiet"
                  disabled={busy || page * 12 >= total}
                  onClick={() => setPage(page + 1)}
                >
                  {t("next")}
                </Button>
              </div>
            </footer>
          </>
        )}
        <footer className="admin-review-note">{t("reviewPending")}</footer>
      </main>
    </div>
  );
}
