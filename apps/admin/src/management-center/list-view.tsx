import {
  LOCALE_NATIVE_NAMES,
  type ManagementCenterListItem,
  type SupportedLocale,
} from "@fan-support/contracts";
import { useState } from "react";
import { Button, Icon, Price } from "@fan-support/ui";
import type { ManagementList, PosterItem } from "./api";
import { managementCopy } from "./copy";
import { giftKindLabel } from "./form-fields";
import { PhotoView } from "./photo-view";
export type ListViewProps = {
  locale: SupportedLocale;
  list: ManagementList;
  busy: boolean;
  onSelect: (item: ManagementCenterListItem) => void;
  onPage: (page: number) => void;
  /** L2-09: old posters can be deleted after an inline confirmation. */
  onDeletePoster?: (item: PosterItem) => void;
};
export function ManagementListView({
  locale,
  list,
  busy,
  onSelect,
  onPage,
  onDeletePoster,
}: ListViewProps) {
  const copy = managementCopy(locale);
  const [confirming, setConfirming] = useState<string | null>(null);
  const poster = list.section === "POSTERS";
  const empty = poster
    ? copy.emptyPosters
    : list.section === "ARTISTS"
      ? copy.emptyArtists
      : copy.emptyGifts;
  const pages = Math.max(1, Math.ceil(list.totalItems / list.pageSize));
  return (
    <div data-management-list={list.section}>
      {list.items.length === 0 ? (
        <p className="mc-empty" role="status">
          {empty}
        </p>
      ) : (
        <ul className="mc-items" data-posters={poster || undefined}>
          {list.items.map((item) => {
            const isPoster = item.kind === "POSTER";
            const unavailable = isPoster && !item.canRestore && !item.current;
            const readOnly = item.kind === "GIFT" && !item.canEdit;
            const name = isPoster
              ? new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(item.createdAt))
              : item.name;
            const state = isPoster
              ? item.current
                ? copy.current
                : unavailable
                  ? copy.imageUnavailable
                  : copy.restore
              : item.status === "active"
                ? copy.published
                : copy[item.status];
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="mc-item"
                  data-management-item={item.id}
                  data-management-kind={item.kind}
                  data-current={isPoster ? item.current : undefined}
                  disabled={
                    busy ||
                    (isPoster && item.current) ||
                    unavailable ||
                    readOnly
                  }
                  onClick={() => onSelect(item)}
                  aria-label={`${isPoster ? (item.current ? copy.current : copy.restore) : copy.edit} · ${name}`}
                >
                  <span className="mc-item-photo" data-kind={item.kind}>
                    {item.image ? (
                      <PhotoView
                        src={item.image.url}
                        alt={item.image.alt}
                        unavailable={copy.imageUnavailable}
                        lazy
                      />
                    ) : (
                      <span className="mc-photo-empty">
                        <Icon name="plus" decorative />
                        <span>
                          {isPoster ? copy.imageUnavailable : copy.upload}
                        </span>
                      </span>
                    )}
                  </span>
                  <span className="mc-item-line">
                    <strong lang={isPoster ? locale : item.sourceLocale}>
                      {name}
                    </strong>
                    <span className="mc-item-action">
                      <Icon
                        name={
                          isPoster && item.current ? "check" : "arrow-right"
                        }
                        decorative
                      />
                    </span>
                  </span>
                  {item.kind === "GIFT" ? (
                    <span className="mc-item-line">
                      <span>{giftKindLabel(item.giftKind, copy)}</span>
                      {item.price ? (
                        <Price
                          locale={locale}
                          currency={item.price.currency}
                          amountMinor={item.price.amountMinor}
                        />
                      ) : (
                        <span>—</span>
                      )}
                    </span>
                  ) : null}
                  <span className="mc-item-meta">
                    {readOnly ? copy.readOnly : state}
                    {!isPoster
                      ? ` · ${copy.original} · ${LOCALE_NATIVE_NAMES[item.sourceLocale]}`
                      : ""}
                  </span>
                </button>
                {item.kind === "POSTER" && item.canDelete && onDeletePoster ? (
                  confirming === item.id ? (
                    <div
                      className="mc-poster-delete"
                      role="group"
                      aria-label={`${copy.posterDelete} · ${name}`}
                      data-management-poster-confirm={item.id}
                    >
                      <p>{copy.posterDeleteWarning}</p>
                      <div className="mc-poster-delete-actions">
                        <Button
                          variant="danger"
                          size="compact"
                          type="button"
                          disabled={busy}
                          data-management-poster-delete-confirm
                          onClick={() => {
                            setConfirming(null);
                            onDeletePoster(item);
                          }}
                        >
                          {copy.posterDeleteConfirm}
                        </Button>
                        <Button
                          variant="quiet"
                          size="compact"
                          type="button"
                          onClick={() => setConfirming(null)}
                        >
                          {copy.posterDeleteCancel}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="quiet"
                      size="compact"
                      type="button"
                      className="mc-poster-delete-trigger"
                      disabled={busy}
                      aria-label={`${copy.posterDelete} · ${name}`}
                      data-management-poster-delete={item.id}
                      onClick={() => setConfirming(item.id)}
                    >
                      <Icon name="close" decorative />
                      {copy.posterDelete}
                    </Button>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {pages > 1 ? (
        <nav
          className="mc-pagination"
          aria-label={`${poster ? copy.history : list.section === "ARTISTS" ? copy.artists : copy.gifts} · ${copy.previous} / ${copy.next}`}
        >
          <Button
            variant="secondary"
            type="button"
            disabled={busy || list.page <= 1}
            onClick={() => onPage(list.page - 1)}
            data-management-previous
          >
            {copy.previous}
          </Button>
          <span>
            {new Intl.NumberFormat(locale).format(list.page)} /{" "}
            {new Intl.NumberFormat(locale).format(pages)}
          </span>
          <Button
            variant="secondary"
            type="button"
            disabled={busy || list.page >= pages}
            onClick={() => onPage(list.page + 1)}
            data-management-next
          >
            {copy.next}
          </Button>
        </nav>
      ) : null}
    </div>
  );
}
