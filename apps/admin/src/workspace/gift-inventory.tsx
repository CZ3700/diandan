"use client";
import { useEffect, useId, useState } from "react";
import { Button, Field } from "@fan-support/ui";
import type { GiftCommerceReadResponse } from "@fan-support/contracts";
import { AdminClientError } from "./client";
import { Select, errorText } from "./components";
import { callCommerce } from "./gift-commerce-client";
import {
  policyLabels,
  policyHints,
  type CommercePanelProps,
} from "./gift-commerce-shared";
type Balances = Extract<
  GiftCommerceReadResponse,
  { kind: "INVENTORY_BALANCES" }
>;
type Ledger = Extract<GiftCommerceReadResponse, { kind: "INVENTORY_LEDGER" }>;
export function GiftInventory({
  client,
  context,
  gift,
  locale,
  t,
  reason,
  busy,
  run,
  onDirty,
  refresh,
}: CommercePanelProps) {
  const id = useId();
  const [variantId, setVariantId] = useState(gift.variants[0]?.id ?? "");
  const [locationId, setLocationId] = useState(
    context.inventoryLocations.find((row) => row.status === "ACTIVE")?.id ?? "",
  );
  const [balances, setBalances] = useState<Balances | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [page, setPage] = useState(1);
  const [delta, setDelta] = useState("");
  const [locationCode, setLocationCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const variant = gift.variants.find((row) => row.id === variantId);
  const balance = balances?.items.find(
    (row) => row.inventoryLocationId === locationId,
  );
  const canEdit =
    !busy && !loading && context.permissions.includes("inventory.manage");
  useEffect(() => {
    onDirty(Boolean(delta || locationCode));
  }, [delta, locationCode, onDirty]);
  useEffect(() => {
    let active = true;
    setBalances(null);
    setLedger(null);
    setError("");
    if (!variantId) return;
    setLoading(true);
    void Promise.all([
      callCommerce(client, {
        schemaVersion: 1,
        action: "READ_INVENTORY",
        giftVariantId: variantId,
        inventoryLocationId: locationId || null,
        view: "BALANCES",
        page: 1,
        pageSize: 50,
      }),
      callCommerce(client, {
        schemaVersion: 1,
        action: "READ_INVENTORY",
        giftVariantId: variantId,
        inventoryLocationId: locationId || null,
        view: "LEDGER",
        page,
        pageSize: 10,
      }),
    ])
      .then(([rows, history]) => {
        if (!active) return;
        if (
          rows.kind !== "INVENTORY_BALANCES" ||
          history.kind !== "INVENTORY_LEDGER"
        )
          throw new AdminClientError("INVALID_RESPONSE");
        setBalances(rows);
        setLedger(history);
      })
      .catch((e: unknown) => {
        if (active) setError(errorText(e, t));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, variantId, locationId, page, tick, t]);
  const leave = () => !(delta || locationCode) || window.confirm(t("discard"));
  return (
    <section
      className="admin-fields"
      aria-label={t("inventory")}
      aria-busy={loading}
    >
      <div className="admin-form-grid">
        <Select
          label={t("variants")}
          value={variantId}
          disabled={busy}
          onChange={(value) => {
            if (!leave()) return;
            setVariantId(value);
            setDelta("");
            setLocationCode("");
            setPage(1);
          }}
        >
          {gift.variants.map((row) => (
            <option key={row.id} value={row.id}>
              {row.sku}
            </option>
          ))}
        </Select>
        <Select
          label={t("location")}
          value={locationId}
          disabled={busy}
          onChange={(value) => {
            if (!leave()) return;
            setLocationId(value);
            setDelta("");
            setLocationCode("");
            setPage(1);
          }}
        >
          <option value="">{t("all")}</option>
          {context.inventoryLocations.map((row) => (
            <option key={row.id} value={row.id}>
              {row.code}
            </option>
          ))}
        </Select>
      </div>
      {variant && (
        <p className="admin-notice">
          <strong>{t(policyLabels[variant.inventoryPolicy])}</strong>
          <br />
          {t(policyHints[variant.inventoryPolicy])}
        </p>
      )}
      {error && (
        <p role="alert" className="admin-error">
          {error}{" "}
          <Button variant="quiet" onClick={() => setTick((i) => i + 1)}>
            {t("retry")}
          </Button>
        </p>
      )}
      {loading && <p role="status">{t("loading")}</p>}
      {balances &&
        (balances.items.length ? (
          <div className="admin-table-wrap">
            <table>
              <caption>{t("inventory")}</caption>
              <thead>
                <tr>
                  <th>{t("location")}</th>
                  <th>{t("onHand")}</th>
                  <th>{t("reserved")}</th>
                  <th>{t("available")}</th>
                </tr>
              </thead>
              <tbody>
                {balances.items.map((row) => (
                  <tr key={row.inventoryLocationId}>
                    <td>
                      {context.inventoryLocations.find(
                        (location) => location.id === row.inventoryLocationId,
                      )?.code ?? row.inventoryLocationId}
                    </td>
                    <td>{row.onHand}</td>
                    <td>{row.reserved}</td>
                    <td>{row.onHand - row.reserved}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : variant?.inventoryPolicy === "TRACKED" ? (
          <p>{t("noInventory")}</p>
        ) : null)}
      {variant?.inventoryPolicy === "TRACKED" && (
        <fieldset disabled={!canEdit} className="admin-fields">
          <Field
            id={`${id}-delta`}
            label={t("adjustment")}
            type="number"
            step={1}
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
          />
          <Button
            disabled={!canEdit || !locationId || !delta || !balances}
            onClick={() =>
              run(async () => {
                if (
                  !/^-?\d+$/u.test(delta) ||
                  !Number.isSafeInteger(Number(delta)) ||
                  Number(delta) === 0
                )
                  throw new AdminClientError("INVALID_COMMAND");
                await callCommerce(client, {
                  schemaVersion: 1,
                  action: "ADJUST_INVENTORY",
                  giftVariantId: variant.id,
                  inventoryLocationId: locationId,
                  expectedVariantVersion: variant.version,
                  expectedBalanceVersion: balance?.version ?? 0,
                  deltaOnHand: Number(delta),
                  reasonCode: reason,
                });
                setDelta("");
                setTick((i) => i + 1);
              }, t("savedCommercial"))
            }
          >
            {t("adjustInventory")}
          </Button>
        </fieldset>
      )}
      <details>
        <summary>{t("newLocation")}</summary>
        <div className="admin-actions">
          <Field
            id={`${id}-location-code`}
            label={t("locationCode")}
            value={locationCode}
            maxLength={64}
            pattern="[A-Z][A-Z0-9_]+"
            disabled={!canEdit}
            onChange={(e) => setLocationCode(e.target.value)}
          />
          <Button
            variant="secondary"
            disabled={!canEdit || !locationCode || Boolean(delta)}
            onClick={() =>
              run(async () => {
                const result = await callCommerce(client, {
                  schemaVersion: 1,
                  action: "CREATE_INVENTORY_LOCATION",
                  expectedVersion: 0,
                  code: locationCode,
                  reasonCode: reason,
                });
                if (
                  result.kind !== "MUTATION" ||
                  result.action !== "CREATE_INVENTORY_LOCATION"
                )
                  throw new AdminClientError("INVALID_RESPONSE");
                setLocationCode("");
                setLocationId(result.inventoryLocationId);
                refresh();
              }, t("savedCommercial"))
            }
          >
            {t("newLocation")}
          </Button>
        </div>
      </details>
      {ledger && (
        <details>
          <summary>{t("balanceHistory")}</summary>
          <div className="admin-table-wrap">
            <table>
              <caption>{t("balanceHistory")}</caption>
              <thead>
                <tr>
                  <th>{t("occurredAt")}</th>
                  <th>{t("adjustment")}</th>
                  <th>{t("reserved")}</th>
                  <th>{t("reason")}</th>
                </tr>
              </thead>
              <tbody>
                {ledger.items.map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.occurredAt).toLocaleString(locale)}</td>
                    <td>
                      {row.deltaOnHand > 0 ? "+" : ""}
                      {row.deltaOnHand}
                    </td>
                    <td>{row.deltaReserved}</td>
                    <td>{row.reasonCode}</td>
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
              disabled={busy || loading || page * 10 >= ledger.totalItems}
              onClick={() => setPage(page + 1)}
            >
              {t("next")}
            </Button>
          </div>
        </details>
      )}
    </section>
  );
}
