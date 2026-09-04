"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type TransitionEvent,
} from "react";

import { buttonVariants } from "./button.js";
import { CompositeMediaFrame } from "./composite-media.js";
import { Icon } from "./icon.js";
import { LiveRegion } from "./live-region.js";
import {
  mediaPresentationReady,
  mediaPresentationSettleReady,
  motionModeForActivation,
  nextIdolSwitchState,
  validateIdolSwitchItems,
  type IdolSwitchItem,
  type IdolSwitchState,
  type MotionMode,
} from "./motion-policy.js";

export type { IdolSwitchItem } from "./motion-policy.js";

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = (): void => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reduced;
}

function itemById(
  items: readonly IdolSwitchItem[],
  id: string,
): IdolSwitchItem {
  const item = items.find((candidate) => candidate.id === id);
  if (item === undefined) {
    throw new TypeError(`Idol switch item ${id} is unavailable.`);
  }
  return item;
}

export type IdolSwitcherProps = Readonly<{
  initialId: string;
  items: readonly IdolSwitchItem[];
  label: string;
  selectedLabel: string;
}>;

export function IdolSwitcher({
  initialId,
  items,
  label,
  selectedLabel,
}: IdolSwitcherProps): ReactElement {
  validateIdolSwitchItems(items, initialId);
  if (label.trim().length === 0 || selectedLabel.trim().length === 0) {
    throw new TypeError(
      "Idol switch label and selected label must be non-empty.",
    );
  }

  const reduced = useReducedMotion();
  const groupId = useId();
  const activeLayerRef = useRef<HTMLDivElement>(null);
  const pointerType = useRef<string | undefined>(undefined);
  const [state, setState] = useState<IdolSwitchState>({
    activeId: initialId,
    mode: "instant",
    outgoingId: null,
    phase: "settled",
    revision: 0,
  });

  useEffect(() => {
    if (state.phase !== "prepare") {
      return;
    }
    const currentLayer = activeLayerRef.current;
    if (currentLayer === null) {
      return;
    }
    const layer: HTMLDivElement = currentLayer;
    const revision = state.revision;
    let cancelled = false;
    let frame: number | undefined;
    let attempt = 0;
    let pendingDecode:
      | Readonly<{
          image: HTMLImageElement;
          resource: string;
        }>
      | undefined;
    let failedDecode:
      | Readonly<{
          image: HTMLImageElement;
          resource: string;
        }>
      | undefined;

    const imageResource = (image: HTMLImageElement): string =>
      JSON.stringify([
        image.getAttribute("src"),
        image.getAttribute("srcset"),
        image.getAttribute("sizes"),
        image.currentSrc,
      ]);

    const presentationState = (
      expectedImage?: HTMLImageElement,
      expectedResource?: string,
    ): Readonly<{
      fallbackVisible: boolean;
      imageComplete: boolean;
      imageNaturalWidth: number;
      imageUnchanged: boolean;
    }> => {
      const image = layer.querySelector("img");
      return {
        fallbackVisible: layer.querySelector("[data-media-fallback]") !== null,
        imageComplete: image?.complete ?? false,
        imageNaturalWidth: image?.naturalWidth ?? 0,
        imageUnchanged:
          image !== null &&
          image === expectedImage &&
          imageResource(image) === expectedResource,
      };
    };

    function settleState(): void {
      setState((current) =>
        current.revision === revision && current.phase === "prepare"
          ? current.mode === "instant"
            ? { ...current, outgoingId: null, phase: "settled" }
            : { ...current, phase: "settled" }
          : current,
      );
    }

    function scheduleSettle(
      decodeOutcome: "failed" | "not-required" | "succeeded",
      expectedImage?: HTMLImageElement,
      expectedResource?: string,
    ): void {
      if (
        cancelled ||
        frame !== undefined ||
        !mediaPresentationSettleReady({
          decodeOutcome,
          ...presentationState(expectedImage, expectedResource),
        })
      ) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = undefined;
        if (cancelled) {
          return;
        }
        if (
          mediaPresentationSettleReady({
            decodeOutcome,
            ...presentationState(expectedImage, expectedResource),
          })
        ) {
          settleState();
        } else {
          settleWhenRenderable();
        }
      });
    }

    function settleWhenRenderable(): void {
      if (cancelled || frame !== undefined) {
        return;
      }
      const fallbackVisible =
        layer.querySelector("[data-media-fallback]") !== null;
      if (fallbackVisible) {
        attempt += 1;
        pendingDecode = undefined;
        scheduleSettle("not-required");
        return;
      }
      const image = layer.querySelector("img");
      if (
        image === null ||
        !mediaPresentationReady({
          fallbackVisible: false,
          imageComplete: image.complete,
          imageNaturalWidth: image.naturalWidth,
        })
      ) {
        return;
      }

      const resource = imageResource(image);
      if (
        pendingDecode !== undefined &&
        (pendingDecode.image !== image || pendingDecode.resource !== resource)
      ) {
        attempt += 1;
        pendingDecode = undefined;
      }
      if (
        failedDecode !== undefined &&
        (failedDecode.image !== image || failedDecode.resource !== resource)
      ) {
        failedDecode = undefined;
      }
      if (
        pendingDecode !== undefined ||
        (failedDecode?.image === image && failedDecode.resource === resource)
      ) {
        return;
      }
      if (typeof image.decode !== "function") {
        scheduleSettle("not-required", image, resource);
        return;
      }

      const currentAttempt = ++attempt;
      pendingDecode = { image, resource };
      void Promise.resolve()
        .then(() => image.decode())
        .then(
          () => {
            if (cancelled || currentAttempt !== attempt) {
              return;
            }
            pendingDecode = undefined;
            scheduleSettle("succeeded", image, resource);
          },
          () => {
            if (cancelled || currentAttempt !== attempt) {
              return;
            }
            pendingDecode = undefined;
            const currentImage = layer.querySelector("img");
            failedDecode =
              currentImage === image && imageResource(image) === resource
                ? { image, resource }
                : undefined;
            settleWhenRenderable();
          },
        );
    }

    const handleLoad = (): void => {
      const image = layer.querySelector("img");
      if (
        image !== null &&
        failedDecode?.image === image &&
        failedDecode.resource === imageResource(image)
      ) {
        failedDecode = undefined;
      }
      settleWhenRenderable();
    };

    const observer = new MutationObserver(() => {
      settleWhenRenderable();
    });
    observer.observe(layer, {
      attributeFilter: ["sizes", "src", "srcset"],
      attributes: true,
      childList: true,
      subtree: true,
    });
    layer.addEventListener("load", handleLoad, true);
    layer.addEventListener("error", settleWhenRenderable, true);
    settleWhenRenderable();

    return () => {
      cancelled = true;
      attempt += 1;
      observer.disconnect();
      layer.removeEventListener("load", handleLoad, true);
      layer.removeEventListener("error", settleWhenRenderable, true);
      if (frame !== undefined) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [state.phase, state.revision]);

  useEffect(() => {
    if (!reduced) {
      return;
    }
    setState((current) =>
      current.mode === "instant"
        ? current
        : current.phase === "prepare"
          ? { ...current, mode: "instant" }
          : {
              ...current,
              mode: "instant",
              outgoingId: null,
              phase: "settled",
            },
    );
  }, [reduced]);

  const activeItem = itemById(items, state.activeId);
  const outgoingItem =
    state.outgoingId === null ? null : itemById(items, state.outgoingId);
  const panelId = `${groupId}-panel`;
  const radioName = `${groupId}-selection`;

  function selectItem(item: IdolSwitchItem): void {
    const activationPointerType = pointerType.current;
    pointerType.current = undefined;
    const mode = motionModeForActivation({
      clickDetail: activationPointerType === undefined ? 0 : 1,
      pointerType: activationPointerType,
      reduced,
    });

    setState((current) => nextIdolSwitchState(current, item.id, mode));
  }

  function finishTransition(event: TransitionEvent<HTMLDivElement>): void {
    if (
      event.target !== event.currentTarget ||
      event.propertyName !== "opacity"
    ) {
      return;
    }
    const revision = Number(event.currentTarget.dataset["motionRevision"]);
    setState((current) =>
      current.revision === revision && current.phase === "settled"
        ? { ...current, mode: "instant", outgoingId: null }
        : current,
    );
  }

  return (
    <fieldset className="fs-motion-idol" data-fs-motion="idol-switcher">
      <legend className="fs-motion-idol__legend">{label}</legend>
      <div className="fs-motion-idol__options">
        {items.map((item, index) => {
          const selected = item.id === state.activeId;
          const inputId = `${groupId}-option-${String(index)}`;
          return (
            <label
              className="fs-motion-idol__option"
              data-selected={selected || undefined}
              htmlFor={inputId}
              key={item.id}
              onPointerDown={(event: PointerEvent<HTMLLabelElement>) => {
                pointerType.current = event.pointerType;
              }}
            >
              <input
                aria-controls={panelId}
                checked={selected}
                className="fs-motion-idol__radio"
                id={inputId}
                name={radioName}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  if (event.currentTarget.checked) {
                    selectItem(item);
                  }
                }}
                onKeyDown={() => {
                  pointerType.current = undefined;
                }}
                type="radio"
                value={item.id}
              />
              <span className="fs-motion-idol__option-name">{item.name}</span>
              {selected ? (
                <span className="fs-motion-idol__selected">
                  {selectedLabel}
                </span>
              ) : null}
            </label>
          );
        })}
      </div>

      <div
        aria-label={activeItem.name}
        className="fs-motion-idol__panel"
        data-motion-mode={state.mode}
        data-motion-phase={state.phase}
        data-motion-revision={state.revision}
        id={panelId}
        role="region"
      >
        <div className="fs-motion-idol__visual">
          {outgoingItem === null ? null : (
            <div
              aria-hidden="true"
              className="fs-motion-idol__media-layer"
              data-layer="outgoing"
              key={outgoingItem.id}
            >
              <CompositeMediaFrame
                className="fs-motion-idol__media"
                media={outgoingItem.media}
              />
            </div>
          )}
          <div
            className="fs-motion-idol__media-layer"
            data-layer="active"
            data-motion-revision={state.revision}
            key={activeItem.id}
            onTransitionEnd={finishTransition}
            ref={activeLayerRef}
          >
            <CompositeMediaFrame
              className="fs-motion-idol__media"
              media={activeItem.media}
            />
          </div>
        </div>

        <div className="fs-motion-idol__copy-stack">
          {items.map((item) => {
            const selected = item.id === state.activeId;
            return (
              <div
                aria-hidden={!selected || undefined}
                className="fs-motion-idol__copy"
                data-active={selected || undefined}
                key={item.id}
              >
                <h3>{item.name}</h3>
                <p>{item.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </fieldset>
  );
}

export type AddToCartStatus = "confirmed" | "error" | "idle" | "pending";

export type AddToCartConfirmationProps = Readonly<{
  announcement: string;
  confirmedLabel: string;
  errorLabel: string;
  label: string;
  onAdd: () => void;
  pendingLabel: string;
  status: AddToCartStatus;
}>;

function requireConfirmationCopy(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`Add-to-cart ${label} must be non-empty.`);
  }
}

export function AddToCartConfirmation({
  announcement,
  confirmedLabel,
  errorLabel,
  label,
  onAdd,
  pendingLabel,
  status,
}: AddToCartConfirmationProps): ReactElement {
  requireConfirmationCopy(announcement, "announcement");
  requireConfirmationCopy(confirmedLabel, "confirmed label");
  requireConfirmationCopy(errorLabel, "error label");
  requireConfirmationCopy(label, "label");
  requireConfirmationCopy(pendingLabel, "pending label");

  const reduced = useReducedMotion();
  const pointerType = useRef<string | undefined>(undefined);
  const [mode, setMode] = useState<MotionMode>("instant");

  useEffect(() => {
    if (reduced || status === "error" || status === "idle") {
      setMode("instant");
    }
  }, [reduced, status]);

  const actionLabel =
    status === "error"
      ? errorLabel
      : status === "pending"
        ? pendingLabel
        : label;
  const accessibleLabel = status === "confirmed" ? confirmedLabel : actionLabel;
  const message =
    status === "confirmed" || status === "error" ? announcement : "";

  function activate(event: MouseEvent<HTMLButtonElement>): void {
    if (status === "pending") {
      return;
    }
    const nextMode = motionModeForActivation({
      clickDetail: event.detail,
      pointerType: pointerType.current,
      reduced,
    });
    pointerType.current = undefined;
    setMode(nextMode);
    onAdd();
  }

  return (
    <div
      className="fs-motion-add"
      data-confirmation-state={status}
      data-fs-motion="add-to-cart"
      data-motion-mode={mode}
    >
      <button
        aria-busy={status === "pending" || undefined}
        aria-disabled={status === "pending" || undefined}
        aria-label={accessibleLabel}
        className={buttonVariants({ className: "fs-motion-add__button" })}
        onClick={activate}
        onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
          if (status === "pending") {
            return;
          }
          pointerType.current = event.pointerType;
          setMode(
            motionModeForActivation({
              clickDetail: 1,
              pointerType: event.pointerType,
              reduced,
            }),
          );
        }}
        type="button"
      >
        <span className="fs-button__label">
          <span className="fs-motion-add__labels">
            <span
              aria-hidden={status === "confirmed" || undefined}
              className="fs-motion-add__label"
              data-layer="action"
            >
              {actionLabel}
            </span>
            <span
              aria-hidden={status !== "confirmed" || undefined}
              className="fs-motion-add__label"
              data-layer="confirmed"
            >
              <Icon decorative name="check" />
              {confirmedLabel}
            </span>
          </span>
        </span>
      </button>
      <LiveRegion
        message={message}
        politeness={status === "error" ? "assertive" : "polite"}
      />
    </div>
  );
}
