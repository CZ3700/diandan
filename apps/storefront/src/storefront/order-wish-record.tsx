"use client";
import { useState } from "react";
import type {
  SupportedLocale,
  WishSupportRecord,
} from "@fan-support/contracts";
import type { StorefrontCopy } from "./copy";
import { WishMedallion } from "./wish-gallery";
import { storefrontHref } from "./navigation";

export function OrderWishRecord({
  record,
  locale,
  copy,
  onWithdraw,
}: Readonly<{
  record: WishSupportRecord;
  locale: SupportedLocale;
  copy: StorefrontCopy;
  onWithdraw?: ((entryId: string) => Promise<boolean>) | undefined;
}>) {
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [failed, setFailed] = useState(false);
  const withdrawn = record.withdrawn || hidden;
  const shared =
    record.visibility !== "PRIVATE" && !withdrawn && !record.revoked;
  async function withdraw() {
    if (busy || !onWithdraw) return;
    setBusy(true);
    setFailed(false);
    try {
      if (await onWithdraw(record.entryId)) setHidden(true);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="order-wish-record" data-order-wish={record.entryId}>
      <div className="order-wish-heading">
        <WishMedallion />
        <div>
          <h4>{record.revoked ? copy.wishReversed : copy.wishSupported}</h4>
          <time dateTime={record.supportedAt}>
            {new Intl.DateTimeFormat(locale, {
              dateStyle: "long",
              timeZone: "UTC",
            }).format(new Date(record.supportedAt))}
          </time>
        </div>
      </div>
      <p>
        {withdrawn
          ? copy.wishRecordHidden
          : shared
            ? copy.wishRecordPublic
            : copy.wishRecordPrivate}
      </p>
      {shared && (
        <>
          <p>
            {record.visibility === "PUBLIC_NAMED"
              ? record.publicAlias
              : copy.wishDisplayAnonymous}
          </p>
          <a
            className="storefront-text-link"
            href={storefrontHref(locale, "/wish-gallery")}
          >
            {copy.wishShowcaseTitle}
          </a>
          {onWithdraw && (
            <div>
              <button
                type="button"
                disabled={busy}
                aria-busy={busy}
                onClick={() => void withdraw()}
              >
                {busy ? copy.wishRecordSaving : copy.wishRecordHide}
              </button>
            </div>
          )}
        </>
      )}
      {failed && <p role="alert">{copy.wishRecordSaveFailed}</p>}
      {withdrawn && (
        <p className="storefront-sr-only" role="status">
          {copy.wishRecordHidden}
        </p>
      )}
    </section>
  );
}
