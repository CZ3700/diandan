import "server-only";
import { Suspense } from "react";
import type {
  IdolDirectoryResponse,
  StorefrontGiftRecipient,
  SupportedLocale,
  WishGiftSummary,
} from "@fan-support/contracts";
import { formatStorefrontMessage, type StorefrontCopy } from "./copy";
import { GiftRecipientPicker } from "./gift-recipient";
import { PublishedImage } from "./published-image";
import { storefrontHref } from "./navigation";
import { wishStatusLabel } from "./wish-status";

type Recipient =
  | Extract<StorefrontGiftRecipient, { kind: "PUBLISHED" }>
  | Readonly<{ kind: "NONE" | "UNAVAILABLE" }>;
type Props = Readonly<{
  artists: Promise<IdolDirectoryResponse>;
  recipient?: StorefrontGiftRecipient;
  locale: SupportedLocale;
  copy: StorefrontCopy;
  contextQuery: string;
  path: string;
  wish?: WishGiftSummary;
}>;

function selectedRecipient(
  artists: IdolDirectoryResponse,
  contextQuery: string,
): Recipient {
  const id = new URLSearchParams(contextQuery).get("idol");
  if (!id) return { kind: "NONE" };
  const artist =
    artists.outcome === "SUCCESS"
      ? artists.items.find((item) => item.id.toLowerCase() === id.toLowerCase())
      : undefined;
  return artist ? { kind: "PUBLISHED", idol: artist } : { kind: "UNAVAILABLE" };
}

function RecipientSummary({
  recipient,
  locale,
  copy,
  contextQuery,
}: Pick<Props, "locale" | "copy" | "contextQuery"> & { recipient: Recipient }) {
  return recipient.kind === "PUBLISHED" ? (
    <div
      className="gift-selected-recipient"
      data-selected-recipient={recipient.idol.id}
    >
      <PublishedImage
        media={recipient.idol.portrait}
        fallbackLabel={copy.mediaFallback}
        sizes="64px"
      />
      <div>
        <a
          lang={recipient.idol.localeContext.resolvedLocale}
          href={storefrontHref(
            locale,
            `/idols/${recipient.idol.handle}`,
            contextQuery,
          )}
        >
          {recipient.idol.displayName}
        </a>
        <p>
          {recipient.idol.acceptingGifts
            ? copy.artistAccepting
            : copy.artistPaused}
        </p>
      </div>
    </div>
  ) : (
    <p role={recipient.kind === "UNAVAILABLE" ? "status" : undefined}>
      {recipient.kind === "UNAVAILABLE"
        ? copy.giftRecipientUnavailable
        : copy.giftRecipientMissing}
    </p>
  );
}

async function DirectoryRecipient(props: Props) {
  return (
    <RecipientSummary
      {...props}
      recipient={selectedRecipient(await props.artists, props.contextQuery)}
    />
  );
}

async function RecipientPicker({ artists, recipient, ...props }: Props) {
  const initial = await artists;
  const selected = recipient ?? selectedRecipient(initial, props.contextQuery);
  return (
    <GiftRecipientPicker
      key={`${props.locale}:${props.contextQuery}`}
      {...props}
      initial={initial}
      selected={selected.kind === "PUBLISHED"}
    />
  );
}

export function GiftDetailRecipient(props: Props) {
  if (props.wish) {
    const { wish, copy, locale } = props;
    const query = new URLSearchParams(props.contextQuery);
    query.delete("idol");
    return (
      <section
        className="gift-recipient-summary wish-recipient"
        data-wish-status={wish.status}
        aria-labelledby="gift-recipient-title"
      >
        <h2 id="gift-recipient-title">
          {formatStorefrontMessage(copy, "wishOnlyFor", locale, {
            artist: wish.artistName,
          })}
        </h2>
        <a
          href={storefrontHref(
            locale,
            `/idols/${wish.artistHandle}`,
            query.toString(),
          )}
        >
          {wish.artistName}
        </a>
        <p role="status">{wishStatusLabel(wish.status, copy)}</p>
        <p className="wish-fine-print">{copy.wishOnlyOnce}</p>
      </section>
    );
  }
  const recipient =
    props.recipient ??
    (new URLSearchParams(props.contextQuery).has("idol")
      ? undefined
      : ({ kind: "NONE" } as const));
  return (
    <section
      className="gift-recipient-summary"
      aria-labelledby="gift-recipient-title"
    >
      <h2 id="gift-recipient-title">{props.copy.giftRecipient}</h2>
      <div className="gift-recipient-status">
        {recipient ? (
          <RecipientSummary {...props} recipient={recipient} />
        ) : (
          <Suspense
            fallback={
              <p role="status" aria-busy="true">
                {props.copy.artistLoading}
              </p>
            }
          >
            <DirectoryRecipient {...props} />
          </Suspense>
        )}
      </div>
      <div className="gift-recipient-control">
        <Suspense
          fallback={
            <div data-gift-recipient-pending aria-busy="true">
              <button
                type="button"
                className="fs-overlay-trigger"
                disabled
                aria-haspopup="dialog"
                aria-expanded="false"
              >
                {recipient?.kind === "PUBLISHED"
                  ? props.copy.giftRecipientChange
                  : props.copy.giftRecipientChoose}
              </button>
            </div>
          }
        >
          <RecipientPicker {...props} />
        </Suspense>
      </div>
    </section>
  );
}
