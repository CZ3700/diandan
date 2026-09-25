"use client";
import { useEffect, useState } from "react";
import {
  adminCatalogResponseSchema,
  type SupportedLocale,
} from "@fan-support/contracts";
import { Button } from "@fan-support/ui";
import type { AdminClient } from "./client";
import type { Translate } from "./components";

export function GiftEligibility({
  client,
  locale,
  t,
  artists,
  onRemove,
}: {
  client: AdminClient;
  locale: SupportedLocale;
  t: Translate;
  artists: { id: string; label: string }[];
  onRemove: (id: string) => void;
}) {
  const [page, setPage] = useState(1);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const currentPage = Math.min(
    page,
    Math.max(1, Math.ceil(artists.length / 10)),
  );
  const visible = artists.slice((currentPage - 1) * 10, currentPage * 10);
  const ids = visible
    .filter((row) => row.label === row.id)
    .map((row) => row.id)
    .join(",");
  useEffect(() => {
    let active = true;
    setLabels({});
    // Only resolve the visible page; an eligibility set may contain 2,000 artists.
    void Promise.allSettled(
      ids
        .split(",")
        .filter(Boolean)
        .map(async (id) => {
          const result = await client.call(
            "catalog-owner",
            {
              schemaVersion: 1,
              target: { kind: "IDOL", idolId: id },
              locale,
            },
            adminCatalogResponseSchema,
          );
          if (active && result.kind === "OWNER") {
            const label = result.owner.label ?? result.owner.handle;
            if (label) setLabels((old) => ({ ...old, [id]: label }));
          }
        }),
    );
    return () => {
      active = false;
    };
  }, [client, ids, locale]);
  return (
    <div>
      {visible.map((artist) => (
        <div className="admin-actions" key={artist.id}>
          <span>
            {artist.label !== artist.id
              ? artist.label
              : (labels[artist.id] ?? t("artistUnavailable"))}
          </span>
          <Button variant="quiet" onClick={() => onRemove(artist.id)}>
            {t("remove")}
          </Button>
        </div>
      ))}
      {artists.length > 10 && (
        <div className="admin-actions">
          <Button
            variant="quiet"
            disabled={currentPage === 1}
            onClick={() => setPage(currentPage - 1)}
          >
            {t("previous")}
          </Button>
          <span>
            {currentPage} / {Math.ceil(artists.length / 10)}
          </span>
          <Button
            variant="quiet"
            disabled={currentPage * 10 >= artists.length}
            onClick={() => setPage(currentPage + 1)}
          >
            {t("next")}
          </Button>
        </div>
      )}
    </div>
  );
}
