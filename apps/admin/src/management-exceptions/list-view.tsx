import type {
  AdminExceptionTarget,
  SupportedLocale,
} from "@fan-support/contracts";
import { Button } from "@fan-support/ui";
import type { ExceptionsList, ExceptionsFilters } from "./api";
import { exceptionsCopy } from "./copy";
import { categoryLabel, statusLabel } from "./labels";
export function ExceptionsListView({
  list,
  filters,
  locale,
  busy,
  onPage,
  onSelect,
}: {
  list: ExceptionsList;
  filters: ExceptionsFilters;
  locale: SupportedLocale;
  busy: boolean;
  onPage: (page: number) => void;
  onSelect: (target: AdminExceptionTarget) => void;
}) {
  const c = exceptionsCopy(locale),
    number = new Intl.NumberFormat(locale);
  return (
    <div data-exceptions-list>
      {list.items.length ? (
        <ul className="me-list">
          {list.items.map((item) => (
            <li
              key={`${item.target.kind}:${item.target.id}:${item.target.consumerKey ?? ""}`}
            >
              <button
                type="button"
                className="me-row"
                disabled={busy}
                data-exceptions-row={item.target.id}
                data-exceptions-kind={item.target.kind}
                onClick={() => onSelect(item.target)}
              >
                <strong>{categoryLabel(item.target.kind, c)}</strong>
                <span>{statusLabel(item.status, c)}</span>
                {item.publicOrderId ? (
                  <span>
                    {c.order}: {item.publicOrderId}
                  </span>
                ) : null}
                <span>
                  {c.attempts}: {number.format(item.attemptCount)}
                </span>
                <time dateTime={item.updatedAt}>
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(item.updatedAt))}
                </time>
                <span className="me-view">{c.view}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mc-empty" data-exceptions-empty>
          {c.empty}
        </p>
      )}
      <nav className="mc-pagination" aria-label={c.title}>
        <Button
          type="button"
          variant="secondary"
          data-exceptions-previous
          disabled={busy || filters.page <= 1}
          onClick={() => onPage(filters.page - 1)}
        >
          {c.previous}
        </Button>
        <span>
          {number.format(list.page)} /{" "}
          {number.format(
            Math.max(1, Math.ceil(list.totalItems / list.pageSize)),
          )}
        </span>
        <Button
          type="button"
          variant="secondary"
          data-exceptions-next
          disabled={
            busy ||
            filters.page >= 10000 ||
            filters.page * filters.pageSize >= list.totalItems
          }
          onClick={() => onPage(filters.page + 1)}
        >
          {c.next}
        </Button>
      </nav>
    </div>
  );
}
