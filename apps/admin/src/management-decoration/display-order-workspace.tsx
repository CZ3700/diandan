"use client";
import { useEffect, useState } from "react";
import { Button, Icon } from "@fan-support/ui";
import type {
  CatalogDisplayOrderItem,
  CatalogDisplayOrderKind,
  SupportedLocale,
} from "@fan-support/contracts";
import { AdminClientError } from "../workspace/client";
import { PhotoView } from "../management-center/photo-view";
import type { DisplayOrderApi, DisplayOrderState } from "./display-order-api";
import { displayOrderCopy } from "./display-order-copy";
import {
  displayOrderIds,
  moveDisplayItem,
  sameDisplayOrder,
} from "./display-order-model";

// L2-10: arrange the storefront order of artists and gifts; saving applies immediately.
export function DisplayOrderWorkspace({
  api,
  locale,
  canPublish,
  onBusy,
  onDirtyChange,
}: {
  api: DisplayOrderApi;
  locale: SupportedLocale;
  canPublish: boolean;
  onBusy: (busy: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const copy = displayOrderCopy(locale);
  const [kind, setKind] = useState<CatalogDisplayOrderKind>("IDOL");
  const [state, setState] = useState<DisplayOrderState | null>(null);
  const [items, setItems] = useState<CatalogDisplayOrderItem[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    "loading",
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const dirty = state !== null && !sameDisplayOrder(items, state.items);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => onBusy(busy), [busy, onBusy]);
  useEffect(() => {
    let canceled = false;
    setStatus("loading");
    api
      .read(kind)
      .then((next) => {
        if (canceled) return;
        setState(next);
        setItems(next.items);
        setStatus("ready");
      })
      .catch(() => {
        if (!canceled) setStatus("failed");
      });
    return () => {
      canceled = true;
    };
  }, [api, kind, reload]);

  async function persist(ids: string[], done: string) {
    if (!state) return;
    setBusy(true);
    setNotice(null);
    try {
      const next = await api.save(kind, ids, state.version);
      setState(next);
      setItems(next.items);
      setNotice(done);
    } catch (error) {
      if (error instanceof AdminClientError && error.code === "STALE_VERSION") {
        setNotice(copy.conflict);
        setReload((value) => value + 1);
      } else setNotice(copy.saveFailed);
    } finally {
      setBusy(false);
    }
  }
  function chooseKind(next: CatalogDisplayOrderKind) {
    if (next === kind || busy) return;
    if (dirty && !window.confirm(copy.discard)) return;
    setNotice(null);
    setKind(next);
  }
  const move = (id: string, direction: -1 | 1 | "top") =>
    setItems((current) => moveDisplayItem(current, id, direction));
  const editable = canPublish && !busy && status === "ready";

  return (
    <section
      className="decoration-order"
      aria-labelledby="display-order-title"
      data-display-order-workspace
    >
      <header className="decoration-order-header">
        <h1 id="display-order-title">{copy.title}</h1>
        <p>{copy.intro}</p>
        <p className="decoration-order-hint">{copy.newItems}</p>
      </header>
      <div className="decoration-order-kinds" role="group">
        {(["IDOL", "GIFT"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={kind === value}
            disabled={busy}
            data-display-order-kind={value}
            onClick={() => chooseKind(value)}
          >
            {value === "IDOL" ? copy.artists : copy.gifts}
          </button>
        ))}
      </div>
      {!canPublish ? <p role="status">{copy.readOnly}</p> : null}
      {notice ? (
        <p role="status" data-display-order-notice>
          {notice}
        </p>
      ) : null}
      {status === "loading" ? <p role="status">{copy.loading}</p> : null}
      {status === "failed" ? (
        <p role="alert" className="decoration-order-error">
          {copy.failed}{" "}
          <Button
            type="button"
            variant="secondary"
            onClick={() => setReload((value) => value + 1)}
          >
            {copy.retry}
          </Button>
        </p>
      ) : null}
      {status === "ready" && items.length === 0 ? (
        <p role="status">{copy.empty}</p>
      ) : null}
      {status === "ready" && items.length > 0 ? (
        <ol
          className="decoration-sections decoration-order-list"
          data-display-order-list={kind}
        >
          {items.map((item, index) => (
            <li key={item.id} data-display-order-item={item.id}>
              <span className="decoration-section-number" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="decoration-order-thumb" aria-hidden="true">
                {item.image ? (
                  <PhotoView src={item.image.url} alt="" unavailable="" lazy />
                ) : null}
              </span>
              <div className="decoration-section-name">
                <strong>{item.name}</strong>
                {item.status === "paused" ? <span>{copy.paused}</span> : null}
              </div>
              <div className="decoration-section-move">
                <Button
                  type="button"
                  variant="quiet"
                  size="compact"
                  data-display-order-top={item.id}
                  disabled={!editable || index === 0}
                  aria-label={`${copy.moveTop}: ${item.name}`}
                  onClick={() => move(item.id, "top")}
                >
                  {copy.moveTop}
                </Button>
                <Button
                  type="button"
                  variant="quiet"
                  data-display-order-up={item.id}
                  disabled={!editable || index === 0}
                  aria-label={`${copy.moveUp}: ${item.name}`}
                  onClick={() => move(item.id, -1)}
                >
                  <Icon
                    name="chevron-down"
                    className="decoration-up-icon"
                    decorative
                  />
                </Button>
                <Button
                  type="button"
                  variant="quiet"
                  data-display-order-down={item.id}
                  disabled={!editable || index === items.length - 1}
                  aria-label={`${copy.moveDown}: ${item.name}`}
                  onClick={() => move(item.id, 1)}
                >
                  <Icon name="chevron-down" decorative />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="decoration-order-actions">
        {dirty ? (
          <span className="decoration-order-dirty">{copy.unsaved}</span>
        ) : null}
        <Button
          type="button"
          variant="primary"
          data-display-order-save
          disabled={!dirty || !editable}
          onClick={() => void persist(displayOrderIds(items), copy.saved)}
        >
          {busy ? copy.saving : copy.save}
        </Button>
        <Button
          type="button"
          variant="secondary"
          data-display-order-revert
          disabled={!dirty || busy}
          onClick={() => state && setItems(state.items)}
        >
          {copy.revert}
        </Button>
        <Button
          type="button"
          variant="quiet"
          data-display-order-reset
          disabled={
            !editable ||
            dirty ||
            !(state?.items.some((item) => item.manual) ?? false)
          }
          onClick={() => {
            if (window.confirm(copy.resetConfirm))
              void persist([], copy.resetDone);
          }}
        >
          {copy.reset}
        </Button>
      </div>
    </section>
  );
}
