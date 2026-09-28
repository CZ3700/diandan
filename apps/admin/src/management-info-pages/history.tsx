import { Button } from "@fan-support/ui";
import type {
  InformationPageWorkspace,
  SupportedLocale,
} from "@fan-support/contracts";
import type { InformationCopy } from "./copy";
import type { InformationHistory as HistoryData } from "./api";
export function InformationHistory({
  state,
  history,
  historyFailed,
  restoreId,
  busy,
  dirty,
  copy,
  locale,
  reloadHistory,
  onHistoryPage,
  onRestoreSelect,
  onRestoreConfirm,
  onUnpublish,
}: {
  state: InformationPageWorkspace;
  history: HistoryData | null;
  historyFailed: boolean;
  restoreId: string | null;
  busy: boolean;
  dirty: boolean;
  copy: InformationCopy;
  locale: SupportedLocale;
  reloadHistory: () => void;
  onHistoryPage: (page: number) => void;
  onRestoreSelect: (id: string | null) => void;
  onRestoreConfirm: () => void;
  onUnpublish: () => void;
}) {
  return (
    <details className="decoration-history" data-info-history>
      <summary>{copy.history}</summary>
      {historyFailed ? (
        <p role="alert">
          {copy.error}
          <Button type="button" variant="quiet" onClick={() => reloadHistory()}>
            {copy.reload}
          </Button>
        </p>
      ) : !history ? (
        <p role="status">{copy.loading}</p>
      ) : (
        <>
          <ol>
            {history.entries.map((entry) => (
              <li key={entry.publicationId}>
                <span>
                  {copy.version} {entry.version} ·{" "}
                  <time dateTime={entry.publishedAt}>
                    {new Intl.DateTimeFormat(locale, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(entry.publishedAt))}
                  </time>
                  {entry.action === "UNPUBLISH" ? ` · ${copy.unpublish}` : ""}
                </span>
                <Button
                  type="button"
                  variant="quiet"
                  data-info-restore={entry.publicationId}
                  disabled={
                    busy ||
                    dirty ||
                    !state.capabilities.canRestore ||
                    entry.action === "UNPUBLISH" ||
                    entry.publicationId === state.published?.publicationId
                  }
                  onClick={() => onRestoreSelect(entry.publicationId)}
                >
                  {copy.restore}
                </Button>
              </li>
            ))}
          </ol>
          {!history.entries.length && <p>{copy.noHistory}</p>}
          {(history.page > 1 || history.hasMore) && (
            <div className="mc-pagination">
              <Button
                type="button"
                variant="quiet"
                disabled={busy || history.page === 1}
                onClick={() => onHistoryPage(history.page - 1)}
              >
                {copy.previous}
              </Button>
              <span>{history.page}</span>
              <Button
                type="button"
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
        <div role="alert">
          <p>{copy.restoreConfirm}</p>
          <Button
            type="button"
            variant="quiet"
            disabled={busy}
            onClick={() => onRestoreSelect(null)}
          >
            {copy.cancel}
          </Button>
          <Button
            type="button"
            data-info-confirm-restore
            disabled={busy || dirty || !state.capabilities.canRestore}
            onClick={() => {
              onRestoreConfirm();
            }}
          >
            {copy.restore}
          </Button>
        </div>
      )}
      <Button
        type="button"
        variant="quiet"
        data-info-unpublish
        disabled={busy || dirty || !state.capabilities.canUnpublish}
        onClick={onUnpublish}
      >
        {copy.unpublish}
      </Button>
    </details>
  );
}
