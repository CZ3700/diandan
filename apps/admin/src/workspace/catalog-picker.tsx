"use client";
import { useEffect, useState } from "react";
import { Button, Field } from "@fan-support/ui";
import {
  adminCatalogResponseSchema,
  type AdminCatalogOwner,
  type ContentAuthoringTarget,
  type SupportedLocale,
} from "@fan-support/contracts";
import { type AdminClient } from "./client";
import { errorText, type Translate } from "./components";
export const ownerKey = (target: ContentAuthoringTarget) =>
  JSON.stringify(target);
export function CatalogPicker({
  client,
  kind,
  locale,
  t,
  onChoose,
}: {
  client: AdminClient;
  kind: ContentAuthoringTarget["kind"];
  locale: SupportedLocale;
  t: Translate;
  onChoose: (owner: AdminCatalogOwner) => void;
}) {
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<AdminCatalogOwner[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    void client
      .call(
        "catalog-list",
        {
          schemaVersion: 1,
          kind,
          locale,
          page,
          pageSize: 10,
          ...(q ? { q } : {}),
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
  }, [client, kind, locale, page, q, t]);
  return (
    <div className="admin-picker">
      <form
        className="admin-search"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQ(input);
        }}
      >
        <Field
          id={`pick-${kind}`}
          label={t("search")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={160}
        />
        <Button type="submit" variant="secondary">
          {t("searchAction")}
        </Button>
      </form>
      {error && <p role="alert">{error}</p>}
      <div aria-busy={busy}>
        {busy ? (
          <p role="status">{t("loading")}</p>
        ) : (
          items.map((owner) => (
            <button
              className="admin-picker-row"
              type="button"
              key={ownerKey(owner.target)}
              onClick={() => onChoose(owner)}
            >
              <span>{owner.label ?? owner.handle ?? t("draft")}</span>
              <small>
                {owner.media
                  ? `${owner.media.width} × ${owner.media.height} · ${owner.media.mimeType}`
                  : owner.handle}
              </small>
            </button>
          ))
        )}
      </div>
      {!busy && !items.length && <p>{t("empty")}</p>}
      <div className="admin-actions">
        <Button
          disabled={page === 1 || busy}
          variant="quiet"
          onClick={() => setPage(page - 1)}
        >
          {t("previous")}
        </Button>
        <span>{page}</span>
        <Button
          disabled={page * 10 >= total || busy}
          variant="quiet"
          onClick={() => setPage(page + 1)}
        >
          {t("next")}
        </Button>
      </div>
    </div>
  );
}
