"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Field } from "@fan-support/ui";
import {
  adminCatalogResponseSchema,
  SUPPORTED_LOCALES,
  type AdminCatalogOwner,
} from "@fan-support/contracts";
import { type AdminClient, type AdminSession } from "./client";
import { type Translate } from "./components";
export function ArtistIdentity({
  client,
  owner,
  session,
  t,
  reason,
  busy,
  contentDirty,
  run,
  refresh,
  onDirty,
}: {
  client: AdminClient;
  owner: AdminCatalogOwner;
  session: AdminSession;
  t: Translate;
  reason: string;
  busy: boolean;
  contentDirty: boolean;
  run: (work: () => Promise<void>) => void;
  refresh: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [handle, setHandle] = useState(owner.handle ?? "");
  const [accepting, setAccepting] = useState(owner.acceptingGifts ?? false);
  const changed =
    owner.target.kind === "IDOL" &&
    (handle !== owner.handle || accepting !== owner.acceptingGifts);
  useEffect(() => {
    onDirty(changed);
    return () => onDirty(false);
  }, [changed, onDirty]);
  const baseline = useRef({
    handle: owner.handle ?? "",
    accepting: owner.acceptingGifts ?? false,
  });
  useEffect(() => {
    const previous = baseline.current;
    setHandle((current) =>
      current === previous.handle ? (owner.handle ?? "") : current,
    );
    setAccepting((current) =>
      current === previous.accepting
        ? (owner.acceptingGifts ?? false)
        : current,
    );
    baseline.current = {
      handle: owner.handle ?? "",
      accepting: owner.acceptingGifts ?? false,
    };
  }, [owner.baseVersion, owner.handle, owner.acceptingGifts]);
  if (owner.target.kind !== "IDOL") return null;
  const idolId = owner.target.idolId;
  const disabled =
    busy ||
    contentDirty ||
    owner.status === "archived" ||
    !session.permissions.includes("content.edit") ||
    !SUPPORTED_LOCALES.every((locale) => session.localeScopes.includes(locale));
  return (
    <details>
      <summary>{t("status")}</summary>
      {changed && <p className="admin-unsaved">{t("unsaved")}</p>}
      <Field
        id="artist-handle"
        label={t("handle")}
        value={handle}
        disabled={disabled}
        onChange={(event) => setHandle(event.target.value)}
      />
      <div className="admin-actions">
        <Button
          variant="secondary"
          disabled={disabled || handle === owner.handle}
          onClick={() =>
            run(async () => {
              await client.call(
                "idol-rename",
                {
                  schemaVersion: 1,
                  idolId,
                  newHandle: handle,
                  expectedBaseVersion: owner.baseVersion,
                  reasonCode: reason,
                },
                adminCatalogResponseSchema,
                true,
              );
              refresh();
            })
          }
        >
          {t("rename")}
        </Button>
      </div>
      <label className="admin-checkbox">
        <input
          type="checkbox"
          checked={accepting}
          disabled={disabled}
          onChange={(event) => setAccepting(event.target.checked)}
        />
        {t("acceptingGifts")}
      </label>
      <div className="admin-actions">
        {(["active", "paused", "archived"] as const).map((status) => (
          <Button
            key={status}
            variant={status === "archived" ? "danger" : "secondary"}
            disabled={
              disabled ||
              (status === owner.status &&
                (status !== "active" || accepting === owner.acceptingGifts))
            }
            onClick={() =>
              run(async () => {
                await client.call(
                  "idol-status",
                  {
                    schemaVersion: 1,
                    idolId,
                    status,
                    acceptingGifts: status === "active" && accepting,
                    expectedBaseVersion: owner.baseVersion,
                    reasonCode: reason,
                  },
                  adminCatalogResponseSchema,
                  true,
                );
                refresh();
              })
            }
          >
            {t(
              status === "active"
                ? "activate"
                : status === "paused"
                  ? "pause"
                  : "archive",
            )}
          </Button>
        ))}
      </div>
    </details>
  );
}
