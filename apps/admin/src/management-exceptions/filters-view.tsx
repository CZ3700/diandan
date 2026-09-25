import { Button } from "@fan-support/ui";
import type { SupportedLocale } from "@fan-support/contracts";
import type { ExceptionsFilters } from "./api";
import { exceptionsCopy } from "./copy";
export function ExceptionsFiltersView({
  filters,
  locale,
  busy,
  onFilters,
}: {
  filters: ExceptionsFilters;
  locale: SupportedLocale;
  busy: boolean;
  onFilters: (filters: ExceptionsFilters) => void;
}) {
  const c = exceptionsCopy(locale);
  return (
    <form
      className="me-filters"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const category = form.get("category") as ExceptionsFilters["category"],
          status = form.get("status") as ExceptionsFilters["status"];
        onFilters({ ...filters, page: 1, category, status });
      }}
    >
      <label className="mc-field">
        <span>{c.category}</span>
        <select
          name="category"
          data-exceptions-category
          defaultValue={filters.category}
          disabled={busy}
        >
          <option value="ALL">{c.all}</option>
          <option value="WEBHOOK">{c.webhook}</option>
          <option value="DEAD_LETTER">{c.deadLetter}</option>
          <option value="PAYMENT">{c.payment}</option>
          <option value="NOTIFICATION">{c.notification}</option>
        </select>
      </label>
      <label className="mc-field">
        <span>{c.status}</span>
        <select
          name="status"
          data-exceptions-status
          defaultValue={filters.status}
          disabled={busy}
        >
          <option value="OPEN">{c.open}</option>
          <option value="ALL">{c.allStates}</option>
        </select>
      </label>
      <Button type="submit" data-exceptions-filter disabled={busy}>
        {c.filter}
      </Button>
    </form>
  );
}
