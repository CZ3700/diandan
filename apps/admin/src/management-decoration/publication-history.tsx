import { Button } from "@fan-support/ui";
import type { SupportedLocale } from "@fan-support/contracts";
import type { DecorationCopy } from "./copy";
type PublicationHistoryProps = {
  kind: "theme" | "navigation" | "brand";
  locale: SupportedLocale;
  copy: Omit<DecorationCopy, "sections">;
  history: {
    entries: readonly {
      publicationId: string;
      version: number;
      publishedAt: string;
    }[];
    page: number;
    hasMore: boolean;
  } | null;
  historyFailed: boolean;
  currentPublicationId: string | null;
  busy: boolean;
  canPublish: boolean;
  restoreId: string | null;
  onHistoryRetry: () => void;
  onHistoryPage: (page: number) => void;
  onRestoreSelect: (id: string | null) => void;
  onRestoreConfirm: () => void;
};
export function PublicationHistory({
  kind,
  locale,
  copy,
  history,
  historyFailed,
  currentPublicationId,
  busy,
  canPublish,
  restoreId,
  onHistoryRetry,
  onHistoryPage,
  onRestoreSelect,
  onRestoreConfirm,
}: PublicationHistoryProps) {
  return (
    <details
      className="decoration-history"
      {...{ [`data-${kind}-history`]: true }}
    >
      <summary>{copy.history}</summary>
      {historyFailed ? (
        <p role="alert">
          {copy.error}{" "}
          <Button variant="quiet" onClick={onHistoryRetry}>
            {copy.reload}
          </Button>
        </p>
      ) : !history ? (
        <p role="status">{copy.loading}</p>
      ) : (
        <>
          {history.entries.length === 0 ? (
            <p className="mc-hint">{copy.noHistory}</p>
          ) : (
            <ol>
              {history.entries.map((entry) => (
                <li key={entry.publicationId}>
                  <div>
                    <strong>
                      {copy.version} {entry.version}
                    </strong>
                    <time dateTime={entry.publishedAt}>
                      {new Intl.DateTimeFormat(locale, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(entry.publishedAt))}
                    </time>
                    {entry.publicationId === currentPublicationId && (
                      <span>{copy.live}</span>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    {...{ [`data-${kind}-restore`]: entry.publicationId }}
                    disabled={
                      busy ||
                      !canPublish ||
                      entry.publicationId === currentPublicationId
                    }
                    onClick={() => onRestoreSelect(entry.publicationId)}
                  >
                    {copy.restore}
                  </Button>
                </li>
              ))}
            </ol>
          )}
          {(history.page > 1 || history.hasMore) && (
            <div className="mc-pagination">
              <Button
                variant="quiet"
                disabled={busy || history.page === 1}
                onClick={() => onHistoryPage(history.page - 1)}
              >
                {copy.previous}
              </Button>
              <span>{history.page}</span>
              <Button
                variant="quiet"
                disabled={busy || !history.hasMore}
                onClick={() => onHistoryPage(history.page + 1)}
              >
                {copy.next}
              </Button>
            </div>
          )}
        </>
      )}
      {restoreId && (
        <div className="decoration-restore-confirm" role="alert">
          <p>{copy.restoreConfirm}</p>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => onRestoreSelect(null)}
          >
            {copy.cancel}
          </Button>
          <Button
            type="button"
            {...{ [`data-${kind}-confirm-restore`]: true }}
            disabled={busy || !canPublish}
            onClick={onRestoreConfirm}
          >
            {copy.restore}
          </Button>
        </div>
      )}
    </details>
  );
}
