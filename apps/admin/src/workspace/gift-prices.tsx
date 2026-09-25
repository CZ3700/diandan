"use client";
import { useEffect, useId, useState } from "react";
import { Button, Field } from "@fan-support/ui";
import type { GiftCommerceReadResponse } from "@fan-support/contracts";
import { AdminClientError } from "./client";
import { Select, Status, errorText } from "./components";
import { callCommerce } from "./gift-commerce-client";
import { currencyDigits, parseAmountMinor } from "./gift-editor-model";
import type { CommercePanelProps } from "./gift-commerce-shared";
type Books = Extract<GiftCommerceReadResponse, { kind: "PRICE_BOOKS" }>;
type Prices = Extract<GiftCommerceReadResponse, { kind: "PRICES" }>;
export function GiftPrices({
  client,
  context,
  gift,
  locale,
  t,
  reason,
  busy,
  run,
  onDirty,
}: CommercePanelProps) {
  const id = useId();
  const [market, setMarket] = useState(context.markets[0]?.market ?? "");
  const currencies =
    context.markets.find((row) => row.market === market)?.currencies ?? [];
  const [currency, setCurrency] = useState(currencies[0] ?? "");
  const [books, setBooks] = useState<Books | null>(null);
  const [prices, setPrices] = useState<Prices | null>(null);
  const [revision, setRevision] = useState<number | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [page, setPage] = useState(1);
  const [variantId, setVariantId] = useState(gift.variants[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const canEdit =
    !busy && !loading && context.permissions.includes("pricing.manage");
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => {
    let active = true;
    setBooks(null);
    setPrices(null);
    setError("");
    if (!market || !currency) return;
    setLoading(true);
    void (async () => {
      const result = await callCommerce(client, {
        schemaVersion: 1,
        action: "READ_PRICES",
        market,
        currency,
        revision: null,
        page: historyPage,
        pageSize: 10,
      });
      if (!active) return;
      if (result.kind !== "PRICE_BOOKS")
        throw new AdminClientError("INVALID_RESPONSE");
      setBooks(result);
      const current =
        revision ?? result.head?.revision ?? result.items[0]?.revision;
      if (current) {
        const rows = await callCommerce(client, {
          schemaVersion: 1,
          action: "READ_PRICES",
          market,
          currency,
          revision: current,
          page,
          pageSize: 10,
        });
        if (!active) return;
        if (rows.kind !== "PRICES")
          throw new AdminClientError("INVALID_RESPONSE");
        setPrices(rows);
      }
    })()
      .catch((e: unknown) => {
        if (active) setError(errorText(e, t));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, market, currency, revision, historyPage, page, tick, t]);
  const leave = () => !dirty || window.confirm(t("discard"));
  const reset = () => {
    setDirty(false);
    setRevision(null);
    setHistoryPage(1);
    setPage(1);
    setAmount("");
    setValidFrom("");
    setValidUntil("");
  };
  const formatAmount = (value: number) =>
    new Intl.NumberFormat(locale, { style: "currency", currency }).format(
      value / 10 ** currencyDigits(currency),
    );
  const selectedVariant = gift.variants.find((row) => row.id === variantId);
  return (
    <section
      className="admin-fields"
      aria-label={t("prices")}
      aria-busy={loading}
    >
      <div className="admin-form-grid">
        <Select
          label={t("market")}
          value={market}
          disabled={busy}
          onChange={(value) => {
            if (!leave()) return;
            reset();
            setMarket(value);
            setCurrency(
              context.markets.find((row) => row.market === value)
                ?.currencies[0] ?? "",
            );
          }}
        >
          {context.markets.map((row) => (
            <option key={row.market} value={row.market}>
              {row.market}
            </option>
          ))}
        </Select>
        <Select
          label={t("currency")}
          value={currency}
          disabled={busy}
          onChange={(value) => {
            if (!leave()) return;
            reset();
            setCurrency(value);
          }}
        >
          {currencies.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
      </div>
      {error && (
        <p role="alert" className="admin-error">
          {error}{" "}
          <Button variant="quiet" onClick={() => setTick((i) => i + 1)}>
            {t("retry")}
          </Button>
        </p>
      )}
      {loading && <p role="status">{t("loading")}</p>}
      {!loading && !prices && <p>{t("noPrices")}</p>}
      {prices && (
        <>
          <div className="admin-actions">
            <strong>
              {t("revision")} {prices.book.revision}
            </strong>
            <Status value={prices.book.lifecycle.status} t={t} />
            <span>{t("items", { count: prices.book.priceCount })}</span>
          </div>
          <div className="admin-table-wrap">
            <table>
              <caption>
                {t("prices")} · {market} / {currency}
              </caption>
              <thead>
                <tr>
                  <th>{t("sku")}</th>
                  <th>{t("amount")}</th>
                </tr>
              </thead>
              <tbody>
                {prices.items.map((row) => (
                  <tr key={row.priceId}>
                    <td>
                      {gift.variants.find(
                        (variant) => variant.id === row.giftVariantId,
                      )?.sku ?? row.giftVariantId}
                    </td>
                    <td>{formatAmount(row.unitAmountMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="admin-actions">
            <Button
              variant="quiet"
              disabled={busy || loading || page === 1}
              onClick={() => setPage(page - 1)}
            >
              {t("previous")}
            </Button>
            <span>{page}</span>
            <Button
              variant="quiet"
              disabled={busy || loading || page * 10 >= prices.totalItems}
              onClick={() => setPage(page + 1)}
            >
              {t("next")}
            </Button>
          </div>
          <small>
            {t("effectiveFrom")}:{" "}
            {new Date(prices.book.validFrom).toLocaleString(locale)}
            {prices.book.validUntil
              ? ` · ${t("effectiveUntil")}: ${new Date(prices.book.validUntil).toLocaleString(locale)}`
              : ""}
          </small>
          <div className="admin-actions">
            <Button
              variant="secondary"
              disabled={
                !canEdit ||
                dirty ||
                !["DRAFT", "VALIDATED"].includes(prices.book.lifecycle.status)
              }
              onClick={() =>
                run(async () => {
                  await callCommerce(client, {
                    schemaVersion: 1,
                    action: "PUBLISH_PRICE_BOOK",
                    market,
                    currency,
                    priceBookId: prices.book.priceBookId,
                    revision: prices.book.revision,
                    expectedContentHash: prices.book.contentHash,
                    expectedHeadVersion: prices.head?.version ?? 0,
                    reasonCode: reason,
                  });
                  setTick((i) => i + 1);
                }, t("savedCommercial"))
              }
            >
              {t("publishPrices")}
            </Button>
            <Button
              variant="quiet"
              disabled={
                !canEdit ||
                dirty ||
                !prices.head ||
                prices.head.revision === prices.book.revision ||
                prices.book.lifecycle.status !== "SUPERSEDED"
              }
              onClick={() =>
                run(async () => {
                  await callCommerce(client, {
                    schemaVersion: 1,
                    action: "ROLLBACK_PRICE_BOOK",
                    market,
                    currency,
                    priceBookId: prices.book.priceBookId,
                    revision: prices.book.revision,
                    expectedContentHash: prices.book.contentHash,
                    expectedHeadVersion: prices.head!.version,
                    reasonCode: reason,
                  });
                  setTick((i) => i + 1);
                }, t("savedCommercial"))
              }
            >
              {t("rollback")}
            </Button>
          </div>
        </>
      )}
      <fieldset
        className="admin-fields"
        disabled={!canEdit || !market || !currency || !gift.variants.length}
      >
        <legend>{t("createPriceRevision")}</legend>
        <p className="admin-muted">{t("priceWindowHint")}</p>
        {prices && !prices.book.singleWindow && (
          <p className="admin-notice">{t("multiplePriceWindows")}</p>
        )}
        <div className="admin-form-grid">
          <Select
            label={t("variants")}
            value={variantId}
            onChange={(value) => {
              setVariantId(value);
              setDirty(true);
            }}
          >
            {gift.variants.map((variant) => (
              <option value={variant.id} key={variant.id}>
                {variant.sku}
              </option>
            ))}
          </Select>
          <Field
            id={`${id}-amount`}
            label={`${t("amount")} · ${currency}`}
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setDirty(true);
            }}
          />
          <Field
            id={`${id}-from`}
            label={t("effectiveFrom")}
            type="datetime-local"
            value={validFrom}
            onChange={(e) => {
              setValidFrom(e.target.value);
              setDirty(true);
            }}
          />
          <Field
            id={`${id}-until`}
            label={t("effectiveUntil")}
            type="datetime-local"
            value={validUntil}
            onChange={(e) => {
              setValidUntil(e.target.value);
              setDirty(true);
            }}
          />
        </div>
        <Button
          disabled={
            !canEdit ||
            !books ||
            !selectedVariant ||
            !amount ||
            !validFrom ||
            (prices !== null && !prices.book.singleWindow)
          }
          onClick={() =>
            run(async () => {
              let unitAmountMinor: number;
              try {
                unitAmountMinor = parseAmountMinor(amount, currency);
              } catch {
                throw new AdminClientError("INVALID_COMMAND");
              }
              const result = await callCommerce(client, {
                schemaVersion: 1,
                action: "CREATE_PRICE_REVISION",
                market,
                currency,
                expectedBookRevision: books!.authoringVersion,
                expectedHeadVersion: books!.head?.version ?? 0,
                source: prices
                  ? {
                      priceBookId: prices.book.priceBookId,
                      revision: prices.book.revision,
                      contentHash: prices.book.contentHash,
                    }
                  : null,
                validFrom: new Date(validFrom).toISOString(),
                validUntil: validUntil
                  ? new Date(validUntil).toISOString()
                  : null,
                changes: [{ giftVariantId: variantId, unitAmountMinor }],
                reasonCode: reason,
              });
              if (
                result.kind !== "MUTATION" ||
                result.action !== "CREATE_PRICE_REVISION"
              )
                throw new AdminClientError("INVALID_RESPONSE");
              setDirty(false);
              setRevision(result.revision);
              setPage(1);
              setAmount("");
              setTick((i) => i + 1);
            }, t("savedCommercial"))
          }
        >
          {t("createPriceRevision")}
        </Button>
      </fieldset>
      {books && (
        <details>
          <summary>{t("priceHistory")}</summary>
          {books.items.map((book) => (
            <button
              className="admin-picker-row"
              type="button"
              key={`${book.priceBookId}-${book.revision}`}
              disabled={busy}
              onClick={() => {
                if (!leave()) return;
                setDirty(false);
                setRevision(book.revision);
                setPage(1);
              }}
            >
              <span>
                {t("revision")} {book.revision}
              </span>
              <Status value={book.lifecycle.status} t={t} />
              <span>{new Date(book.validFrom).toLocaleString(locale)}</span>
            </button>
          ))}
          <div className="admin-actions">
            <Button
              variant="quiet"
              disabled={busy || loading || historyPage === 1}
              onClick={() => setHistoryPage(historyPage - 1)}
            >
              {t("previous")}
            </Button>
            <span>{historyPage}</span>
            <Button
              variant="quiet"
              disabled={busy || loading || historyPage * 10 >= books.totalItems}
              onClick={() => setHistoryPage(historyPage + 1)}
            >
              {t("next")}
            </Button>
          </div>
        </details>
      )}
    </section>
  );
}
