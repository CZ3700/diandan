"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  AdminLedgerBrokerFilter,
  AdminLedgerExportScope,
  AdminLedgerLine,
  AdminLedgerPeriod,
  AdminLedgerTotal,
  SupportedLocale,
} from "@fan-support/contracts";
import { ADMIN_LEDGER_MAX_PERIOD_DAYS } from "@fan-support/contracts";
import { Button, Icon, Price } from "@fan-support/ui";
import { AdminClientError } from "../workspace/client";
import type {
  LedgerApi,
  LedgerArtistView,
  LedgerContext,
  LedgerMessage,
  LedgerOverview,
} from "./api";
import { ledgerCopy, type LedgerCopy } from "./copy";
import {
  brokerName,
  fill,
  filterArtists,
  formatInstant,
  giftKindLabel,
  ledgerFileName,
  ledgerWorkbook,
  lineStatus,
  periodText,
  scopeText,
  splitLines,
  zoneLabel,
} from "./model";
import { buildXlsx, XLSX_MEDIA_TYPE } from "./xlsx";
import "./ledger.css";

// ADR-022 / L3-12: the artist ledger. Two levels only: every artist in scope, then one artist's gifts.

const PRESETS = ["TODAY", "THIS_WEEK", "THIS_MONTH", "LAST_MONTH"] as const;
const presetLabel = (kind: (typeof PRESETS)[number], copy: LedgerCopy) =>
  kind === "TODAY"
    ? copy.today
    : kind === "THIS_WEEK"
      ? copy.thisWeek
      : kind === "THIS_MONTH"
        ? copy.thisMonth
        : copy.lastMonth;

function customValid(from: string, to: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(from) || !/^\d{4}-\d{2}-\d{2}$/u.test(to))
    return false;
  const days =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
    86_400_000;
  return days >= 0 && days < ADMIN_LEDGER_MAX_PERIOD_DAYS;
}

function withAmount(template: string, amount: ReactNode): ReactNode {
  const [before, after] = template.split("{amount}");
  return (
    <>
      {before}
      {amount}
      {after}
    </>
  );
}

function download(bytes: Uint8Array, fileName: string) {
  const url = URL.createObjectURL(
    new Blob([bytes as Uint8Array<ArrayBuffer>], { type: XLSX_MEDIA_TYPE }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function PeriodPicker({
  period,
  today,
  copy,
  disabled,
  onPeriod,
}: {
  period: AdminLedgerPeriod;
  today: string;
  copy: LedgerCopy;
  disabled: boolean;
  onPeriod: (period: AdminLedgerPeriod) => void;
}) {
  const [customOpen, setCustomOpen] = useState(period.kind === "CUSTOM");
  const [from, setFrom] = useState(
    period.kind === "CUSTOM" ? period.from : today,
  );
  const [to, setTo] = useState(period.kind === "CUSTOM" ? period.to : today);
  const valid = customValid(from, to);
  return (
    <fieldset className="ml-period" data-ledger-period>
      <legend>{copy.period}</legend>
      <div className="ml-segments">
        {PRESETS.map((kind) => (
          <button
            key={kind}
            type="button"
            className="ml-segment"
            data-ledger-preset={kind}
            aria-pressed={!customOpen && period.kind === kind}
            disabled={disabled}
            onClick={() => {
              setCustomOpen(false);
              onPeriod({ kind });
            }}
          >
            {presetLabel(kind, copy)}
          </button>
        ))}
        <button
          type="button"
          className="ml-segment"
          data-ledger-preset="CUSTOM"
          aria-pressed={customOpen}
          aria-expanded={customOpen}
          disabled={disabled}
          onClick={() => setCustomOpen(true)}
        >
          {copy.custom}
        </button>
      </div>
      {customOpen ? (
        <form
          className="ml-custom"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) onPeriod({ kind: "CUSTOM", from, to });
          }}
        >
          <label className="mc-field">
            <span>{copy.from}</span>
            <input
              type="date"
              data-ledger-from
              value={from}
              max={to}
              disabled={disabled}
              onChange={(event) => setFrom(event.currentTarget.value)}
            />
          </label>
          <label className="mc-field">
            <span>{copy.to}</span>
            <input
              type="date"
              data-ledger-to
              value={to}
              min={from}
              disabled={disabled}
              onChange={(event) => setTo(event.currentTarget.value)}
            />
          </label>
          <Button
            type="submit"
            variant="secondary"
            data-ledger-apply
            disabled={disabled || !valid}
          >
            {copy.apply}
          </Button>
        </form>
      ) : null}
    </fieldset>
  );
}

function Totals({
  totals,
  locale,
  copy,
}: {
  totals: readonly AdminLedgerTotal[];
  locale: SupportedLocale;
  copy: LedgerCopy;
}) {
  if (totals.length === 0) return null;
  const count = (value: number) =>
    fill(copy.ordersCount, {
      count: new Intl.NumberFormat(locale).format(value),
    });
  return (
    <div className="ml-totals" data-ledger-totals>
      {totals.map((total) => (
        <section
          key={`${total.environment}-${total.currency}`}
          className="ml-total"
          data-ledger-total={`${total.environment}-${total.currency}`}
          aria-label={
            total.environment === "TEST"
              ? `${total.currency} · ${copy.test}`
              : total.currency
          }
        >
          <p className="ml-total-heading">
            <strong>{total.currency}</strong>
            {total.environment === "TEST" ? (
              <span className="ml-badge">{copy.test}</span>
            ) : null}
          </p>
          {total.environment === "TEST" ? (
            <p className="ml-note">{copy.testNote}</p>
          ) : null}
          <dl>
            <div>
              <dt>{copy.completed}</dt>
              <dd>
                <Price
                  locale={locale}
                  currency={total.currency}
                  amountMinor={total.completedMinor}
                />
                <span className="ml-count">{count(total.completedOrders)}</span>
              </dd>
            </div>
            <div>
              <dt>{copy.pending}</dt>
              <dd>
                <Price
                  locale={locale}
                  currency={total.currency}
                  amountMinor={total.pendingMinor}
                />
                <span className="ml-count">{count(total.pendingOrders)}</span>
              </dd>
            </div>
            <div>
              <dt>{copy.refunded}</dt>
              <dd>
                <Price
                  locale={locale}
                  currency={total.currency}
                  amountMinor={total.refundedMinor}
                />
                {total.refundPendingMinor > 0 ? (
                  <span className="ml-count">
                    {withAmount(
                      copy.refundPending,
                      <Price
                        locale={locale}
                        currency={total.currency}
                        amountMinor={total.refundPendingMinor}
                      />,
                    )}
                  </span>
                ) : null}
              </dd>
            </div>
            <div className="ml-net">
              <dt>{copy.net}</dt>
              <dd>
                <Price
                  locale={locale}
                  currency={total.currency}
                  amountMinor={total.netMinor}
                />
              </dd>
            </div>
          </dl>
        </section>
      ))}
    </div>
  );
}

function Rules({ copy, zone }: { copy: LedgerCopy; zone: string }) {
  return (
    <details className="ml-rules" data-ledger-rules>
      <summary>{copy.rulesTitle}</summary>
      <ul>
        {[
          fill(copy.ruleTime, { zone }),
          copy.ruleCompleted,
          copy.rulePending,
          copy.ruleRefunded,
          copy.ruleExcluded,
          copy.ruleCurrency,
        ].map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>
    </details>
  );
}

function messageError(error: unknown, copy: LedgerCopy): string {
  const code = error instanceof AdminClientError ? error.code : "";
  if (code === "LANGUAGE_REVIEW_REQUIRED") return copy.languageRequired;
  if (
    [
      "PRIVATE_CONTENT_UNAVAILABLE",
      "NOT_FOUND",
      "STALE_VERSION",
      "FORBIDDEN",
    ].includes(code)
  )
    return copy.messageUnavailable;
  return copy.loadError;
}

/** Opens one fan message on demand; the plaintext lives only in this row and closes when its access expires. */
function MessageReveal({
  api,
  line,
  intentVersion,
  locale,
  copy,
}: {
  api: LedgerApi;
  line: AdminLedgerLine;
  intentVersion: number;
  locale: SupportedLocale;
  copy: LedgerCopy;
}) {
  const [message, setMessage] = useState<LedgerMessage | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(
      () => setMessage(null),
      Math.max(0, Date.parse(message.expiresAt) - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [message]);
  if (message) {
    const content = message.content;
    return (
      <div
        className="ml-message"
        role="region"
        aria-label={copy.message}
        data-ledger-message-open
      >
        <dl>
          <div>
            <dt>{copy.signature}</dt>
            <dd>
              {content.displayMode === "nickname"
                ? content.displayName
                : copy.anonymous}
            </dd>
          </div>
          <div>
            <dt>{copy.message}</dt>
            <dd className="ml-message-text">
              {content.fanMessage ? content.fanMessage : copy.noMessageText}
            </dd>
          </div>
        </dl>
        <p className="ml-note">{copy.messageAudit}</p>
        <Button
          type="button"
          variant="secondary"
          data-ledger-message-hide
          onClick={() => setMessage(null)}
        >
          {copy.hideMessage}
        </Button>
      </div>
    );
  }
  return (
    <div className="ml-message-action">
      <Button
        type="button"
        variant="secondary"
        data-ledger-message={line.itemId}
        disabled={loading}
        onClick={() => {
          setLoading(true);
          setError(null);
          void api
            .readMessage({
              orderId: line.orderId,
              itemId: line.itemId,
              expectedIntentVersion: intentVersion,
              reviewLocale: locale,
            })
            .then(
              (value) => {
                if (live.current) setMessage(value);
              },
              (failure: unknown) => {
                if (live.current) setError(messageError(failure, copy));
              },
            )
            .finally(() => {
              if (live.current) setLoading(false);
            });
        }}
      >
        {loading ? copy.messageLoading : copy.viewMessage}
      </Button>
      {error ? (
        <p className="ml-note" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function LineTable({
  kind,
  lines,
  api,
  locale,
  timeZone,
  copy,
}: {
  kind: "PENDING" | "COMPLETED" | "CLOSED";
  lines: readonly AdminLedgerLine[];
  api: LedgerApi;
  locale: SupportedLocale;
  timeZone: string;
  copy: LedgerCopy;
}) {
  const title =
    kind === "PENDING"
      ? copy.pendingList
      : kind === "COMPLETED"
        ? copy.completedList
        : copy.closedList;
  const price = (line: AdminLedgerLine, amount: number) => (
    <Price
      locale={locale}
      currency={line.currency}
      amountMinor={amount as AdminLedgerLine["amountMinor"]}
    />
  );
  const messages = lines.some((line) => line.message !== null);
  return (
    <section
      className="ml-lines"
      data-ledger-lines={kind}
      aria-labelledby={`ml-lines-${kind}`}
    >
      <h3 id={`ml-lines-${kind}`}>
        {title}{" "}
        <span className="ml-count">
          {new Intl.NumberFormat(locale).format(lines.length)}
        </span>
      </h3>
      <div
        className="ml-scroll"
        role="region"
        aria-labelledby={`ml-lines-${kind}`}
        tabIndex={0}
      >
        <table className="ml-table">
          <thead>
            <tr>
              <th scope="col">{copy.orderNumber}</th>
              <th scope="col">{copy.paidAt}</th>
              <th scope="col">{copy.gift}</th>
              <th scope="col" className="ml-number">
                {copy.quantity}
              </th>
              <th scope="col" className="ml-number">
                {copy.amount}
              </th>
              {kind === "PENDING" ? (
                <>
                  <th scope="col">{copy.status}</th>
                  <th scope="col" className="ml-number">
                    {copy.waiting}
                  </th>
                </>
              ) : (
                <>
                  <th scope="col" className="ml-number">
                    {copy.refunded}
                  </th>
                  <th scope="col" className="ml-number">
                    {copy.netAmount}
                  </th>
                  <th scope="col">
                    {kind === "COMPLETED" ? copy.deliveredAt : copy.status}
                  </th>
                </>
              )}
              {messages ? <th scope="col">{copy.message}</th> : null}
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.itemId} data-ledger-line={line.itemId}>
                <td>
                  <span className="ml-order">{line.orderNumber}</span>
                  {line.environment === "TEST" ? (
                    <span className="ml-badge">{copy.test}</span>
                  ) : null}
                </td>
                <td>{formatInstant(line.paidAt, locale, timeZone)}</td>
                <td>
                  <span>{line.giftTitle}</span>
                  <span className="ml-meta">
                    {giftKindLabel(line.giftKind, copy)}
                  </span>
                </td>
                <td className="ml-number">
                  {new Intl.NumberFormat(locale).format(line.quantity)}
                </td>
                <td className="ml-number">{price(line, line.amountMinor)}</td>
                {kind === "PENDING" ? (
                  <>
                    <td>
                      <span
                        className="ml-status"
                        data-ledger-status={line.fulfillmentStatus ?? "NONE"}
                      >
                        {lineStatus(line, copy)}
                      </span>
                      {line.refundPendingMinor > 0 ? (
                        <span className="ml-meta">
                          {withAmount(
                            copy.refundPending,
                            price(line, line.refundPendingMinor),
                          )}
                        </span>
                      ) : null}
                    </td>
                    <td className="ml-number">
                      {line.waitingDays === null
                        ? ""
                        : fill(copy.waitingDays, {
                            count: new Intl.NumberFormat(locale).format(
                              line.waitingDays,
                            ),
                          })}
                    </td>
                  </>
                ) : (
                  <>
                    <td className="ml-number">
                      {price(line, line.refundedMinor)}
                    </td>
                    <td className="ml-number">{price(line, line.netMinor)}</td>
                    <td>
                      {kind === "COMPLETED" ? (
                        line.deliveredAt === null ? (
                          ""
                        ) : (
                          formatInstant(line.deliveredAt, locale, timeZone)
                        )
                      ) : (
                        <span
                          className="ml-status"
                          data-ledger-status={
                            line.chargebackLost ? "CHARGEBACK" : line.category
                          }
                        >
                          {lineStatus(line, copy)}
                        </span>
                      )}
                    </td>
                  </>
                )}
                {messages ? (
                  <td>
                    {line.message ? (
                      <MessageReveal
                        api={api}
                        line={line}
                        intentVersion={line.message.intentVersion}
                        locale={locale}
                        copy={copy}
                      />
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ArtistTable({
  overview,
  query,
  showBroker,
  locale,
  copy,
  disabled,
  onSelect,
}: {
  overview: LedgerOverview;
  query: string;
  showBroker: boolean;
  locale: SupportedLocale;
  copy: LedgerCopy;
  disabled: boolean;
  onSelect: (artistId: string) => void;
}) {
  const rows = filterArtists(overview.artists, query, locale);
  if (overview.artists.length === 0)
    return (
      <p className="mc-empty" role="status" data-ledger-empty>
        {copy.empty}
      </p>
    );
  if (rows.length === 0)
    return (
      <p className="mc-empty" role="status" data-ledger-no-match>
        {copy.noMatch}
      </p>
    );
  const count = (value: number) =>
    fill(copy.ordersCount, {
      count: new Intl.NumberFormat(locale).format(value),
    });
  return (
    <div
      className="ml-scroll"
      role="region"
      aria-label={copy.title}
      tabIndex={0}
    >
      <table className="ml-table" data-ledger-artists>
        <thead>
          <tr>
            <th scope="col">{copy.artist}</th>
            {showBroker ? <th scope="col">{copy.assignedBroker}</th> : null}
            <th scope="col" className="ml-number">
              {copy.completed}
            </th>
            <th scope="col" className="ml-number">
              {copy.pending}
            </th>
            <th scope="col" className="ml-number">
              {copy.refunded}
            </th>
            <th scope="col" className="ml-number">
              {copy.net}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.artistId}-${row.environment}-${row.currency}`}
              data-ledger-artist={row.artistId}
            >
              <th scope="row">
                <button
                  type="button"
                  className="ml-artist"
                  data-ledger-open-artist={row.artistId}
                  disabled={disabled}
                  onClick={() => onSelect(row.artistId)}
                >
                  {row.displayName}
                </button>
                <span className="ml-meta">
                  {row.currency}
                  {row.environment === "TEST" ? (
                    <span className="ml-badge">{copy.test}</span>
                  ) : null}
                  {row.archived ? ` · ${copy.archived}` : ""}
                </span>
              </th>
              {showBroker ? (
                <td data-ledger-broker>{brokerName(row.broker, copy)}</td>
              ) : null}
              <td className="ml-number">
                <Price
                  locale={locale}
                  currency={row.currency}
                  amountMinor={row.completedMinor}
                />
                <span className="ml-meta">{count(row.completedOrders)}</span>
              </td>
              <td className="ml-number">
                <Price
                  locale={locale}
                  currency={row.currency}
                  amountMinor={row.pendingMinor}
                />
                <span className="ml-meta">{count(row.pendingOrders)}</span>
              </td>
              <td className="ml-number">
                <Price
                  locale={locale}
                  currency={row.currency}
                  amountMinor={row.refundedMinor}
                />
              </td>
              <td className="ml-number ml-net">
                <Price
                  locale={locale}
                  currency={row.currency}
                  amountMinor={row.netMinor}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LedgerWorkspace({
  api,
  context,
  locale,
  onBusy,
  standalone = false,
}: {
  api: LedgerApi;
  context: LedgerContext;
  locale: SupportedLocale;
  onBusy: (busy: boolean) => void;
  /** A broker's own section has the page heading; inside the orders area the ledger is a sub-view. */
  standalone?: boolean;
}) {
  const copy = ledgerCopy(locale);
  const [period, setPeriod] = useState<AdminLedgerPeriod>({
      kind: "THIS_MONTH",
    }),
    [broker, setBroker] = useState<AdminLedgerBrokerFilter>({ kind: "ALL" }),
    [query, setQuery] = useState(""),
    [artistId, setArtistId] = useState<string | null>(null);
  const [overview, setOverview] = useState<LedgerOverview | null>(null),
    [artist, setArtist] = useState<LedgerArtistView | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),
    [refresh, setRefresh] = useState(0);
  const [exporting, setExporting] = useState(false),
    [exported, setExported] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null),
    live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setError(null);
    const work = artistId
      ? api.artist(artistId, period).then((value) => {
          if (!canceled) setArtist(value);
        })
      : api.overview(period, broker).then((value) => {
          if (!canceled) setOverview(value);
        });
    void work
      .catch((failure: unknown) => {
        if (canceled) return;
        if (
          artistId &&
          failure instanceof AdminClientError &&
          failure.code === "NOT_FOUND"
        ) {
          setArtistId(null);
          setArtist(null);
        }
        setError(copy.loadError);
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [api, artistId, period, broker, refresh, copy.loadError]);
  useEffect(() => {
    heading.current?.focus();
  }, [artistId]);

  const Heading = standalone ? "h1" : "h2";
  const current = artistId ? artist : overview;
  const zone = zoneLabel(current?.period.timeZone ?? context.timeZone, locale);
  const exportScope: AdminLedgerExportScope = artistId
    ? { kind: "ARTIST", artistId }
    : broker.kind === "BROKER"
      ? { kind: "BROKER", brokerId: broker.brokerId }
      : broker.kind === "UNASSIGNED"
        ? { kind: "UNASSIGNED" }
        : { kind: "ALL" };
  const exportLabel = artistId
    ? (artist?.artist.displayName ?? "")
    : context.scope === "ASSIGNED"
      ? copy.exportScopeMine
      : scopeText(
          exportScope,
          broker.kind === "BROKER"
            ? (context.brokers.find((b) => b.brokerId === broker.brokerId)
                ?.displayName ?? null)
            : null,
          copy,
        );
  const busy = loading || exporting;

  async function runExport() {
    setExporting(true);
    setExported(null);
    setError(null);
    onBusy(true);
    try {
      const result = await api.export(exportScope, period);
      const fileName = ledgerFileName(result, copy);
      download(buildXlsx(ledgerWorkbook(result, copy, locale)), fileName);
      if (live.current) setExported(fill(copy.exported, { file: fileName }));
    } catch {
      if (live.current) setError(copy.loadError);
    } finally {
      if (live.current) setExporting(false);
      onBusy(false);
    }
  }

  const parts = artist ? splitLines(artist.lines) : null;
  return (
    <section className="ml-workspace" data-ledger-workspace aria-busy={busy}>
      <header className="mc-workspace-header">
        <div>
          {artistId ? (
            <button
              className="mc-back"
              type="button"
              data-ledger-back
              disabled={exporting}
              onClick={() => {
                setArtistId(null);
                setArtist(null);
                setExported(null);
              }}
            >
              <Icon name="arrow-left" decorative />
              {copy.backToOverview}
            </button>
          ) : null}
          <Heading ref={heading} tabIndex={-1} data-ledger-heading>
            {artistId ? (artist?.artist.displayName ?? copy.title) : copy.title}
          </Heading>
          {artistId && artist ? (
            <p className="ml-meta" data-ledger-artist-broker>
              {context.scope === "ALL" ? (
                <>
                  <span>{copy.assignedBroker}</span>{" "}
                  <strong>{brokerName(artist.artist.broker, copy)}</strong>
                </>
              ) : null}
              {artist.artist.archived ? (
                <span className="ml-badge">{copy.archived}</span>
              ) : null}
            </p>
          ) : null}
        </div>
      </header>
      <div className="ml-toolbar">
        <PeriodPicker
          period={period}
          today={context.today}
          copy={copy}
          disabled={busy}
          onPeriod={(next) => {
            setExported(null);
            setPeriod(next);
          }}
        />
        {!artistId ? (
          <div className="ml-filters">
            {context.scope === "ALL" ? (
              <label className="mc-field">
                <span>{copy.broker}</span>
                <select
                  data-ledger-broker-filter
                  disabled={busy}
                  value={
                    broker.kind === "BROKER" ? broker.brokerId : broker.kind
                  }
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setExported(null);
                    setBroker(
                      value === "ALL" || value === "UNASSIGNED"
                        ? { kind: value }
                        : { kind: "BROKER", brokerId: value },
                    );
                  }}
                >
                  <option value="ALL">{copy.allBrokers}</option>
                  <option value="UNASSIGNED">{copy.unassigned}</option>
                  {context.brokers.map((entry) => (
                    <option key={entry.brokerId} value={entry.brokerId}>
                      {entry.active
                        ? entry.displayName
                        : `${entry.displayName} ${copy.suspended}`}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="mc-field">
              <span>{copy.search}</span>
              <input
                type="search"
                data-ledger-search
                value={query}
                maxLength={80}
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
          </div>
        ) : null}
        <div className="ml-export">
          <Button
            type="button"
            data-ledger-export
            disabled={busy || !current}
            onClick={() => void runExport()}
          >
            {exporting
              ? copy.exporting
              : artistId
                ? copy.exportArtist
                : copy.exportTable}
          </Button>
          <p className="ml-note" data-ledger-export-scope>
            {fill(copy.exportFor, { scope: exportLabel })}
          </p>
        </div>
      </div>
      {current ? (
        <p className="ml-period-text" data-ledger-period-text>
          {periodText(current.period, locale, copy)}
        </p>
      ) : null}
      <Rules copy={copy} zone={zone} />
      {exported ? (
        <p className="mc-success" role="status" data-ledger-exported>
          {exported}
        </p>
      ) : null}
      {error ? (
        <div className="mc-error-state" role="alert">
          <p>{error}</p>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => setRefresh((value) => value + 1)}
          >
            {copy.retry}
          </Button>
        </div>
      ) : null}
      {loading ? (
        <p className="mc-empty" role="status">
          {copy.loading}
        </p>
      ) : artistId ? (
        artist && parts ? (
          <>
            <Totals totals={artist.totals} locale={locale} copy={copy} />
            {artist.truncated ? (
              <p className="ml-note" role="status" data-ledger-truncated>
                {copy.truncated}
              </p>
            ) : null}
            {artist.lines.length === 0 ? (
              <p className="mc-empty" role="status" data-ledger-no-lines>
                {copy.noLines}
              </p>
            ) : (
              <>
                {parts.pending.length > 0 ? (
                  <LineTable
                    kind="PENDING"
                    lines={parts.pending}
                    api={api}
                    locale={locale}
                    timeZone={artist.period.timeZone}
                    copy={copy}
                  />
                ) : null}
                {parts.completed.length > 0 ? (
                  <LineTable
                    kind="COMPLETED"
                    lines={parts.completed}
                    api={api}
                    locale={locale}
                    timeZone={artist.period.timeZone}
                    copy={copy}
                  />
                ) : null}
                {parts.closed.length > 0 ? (
                  <LineTable
                    kind="CLOSED"
                    lines={parts.closed}
                    api={api}
                    locale={locale}
                    timeZone={artist.period.timeZone}
                    copy={copy}
                  />
                ) : null}
              </>
            )}
          </>
        ) : null
      ) : overview ? (
        <>
          <Totals totals={overview.totals} locale={locale} copy={copy} />
          <ArtistTable
            overview={overview}
            query={query}
            showBroker={context.scope === "ALL"}
            locale={locale}
            copy={copy}
            disabled={busy}
            onSelect={(id) => {
              setExported(null);
              setArtistId(id);
            }}
          />
        </>
      ) : null}
    </section>
  );
}
