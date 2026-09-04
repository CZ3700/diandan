import type { ReactElement, ReactNode } from "react";

import { CompositeMediaFrame } from "./composite-media.js";
import { CompositeStateContent } from "./composite-state.js";
import type {
  CompositeAction,
  CompositeMedia,
  CompositeMoney,
  CompositeView,
} from "./composite-types.js";
import { Link } from "./link.js";
import { Price } from "./price.js";
import { Status } from "./status.js";

export type CartLineReadyProps = Readonly<{
  availability?: Readonly<{
    kind: "available" | "unavailable";
    label: string;
  }>;
  editAction?: CompositeAction;
  gift: Readonly<{
    href?: string;
    media: CompositeMedia;
    title: string;
    variantLabel?: string;
  }>;
  idol: Readonly<{
    contextLabel: string;
    href?: string;
    media: CompositeMedia;
    name: string;
  }>;
  lineTotal: CompositeMoney;
  message: Readonly<{
    kind: "none" | "present";
    label: string;
  }>;
  quantity: Readonly<{
    label: string;
    value: number;
  }>;
}>;

export type CartLineProps = CompositeView<CartLineReadyProps>;

function linkedOrPlain(
  value: string,
  href: string | undefined,
): ReactElement | string {
  return href === undefined ? (
    value
  ) : (
    <Link href={href} variant="standalone">
      {value}
    </Link>
  );
}

export function validateCartLineQuantity(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError("CartLine quantity must be a positive safe integer.");
  }
}

export function CartLineLayout({
  props,
  quantityControl,
  removeControl,
}: Readonly<{
  props: CartLineReadyProps;
  quantityControl?: ReactNode;
  removeControl?: ReactNode;
}>): ReactElement {
  validateCartLineQuantity(props.quantity.value);

  return (
    <article
      className="fs-cart-line"
      data-availability={props.availability?.kind}
      data-fs-composite="cart-line"
      data-render-state="ready"
    >
      <div className="fs-cart-line__visuals">
        <CompositeMediaFrame
          className="fs-cart-line__gift-media"
          media={props.gift.media}
        />
        <CompositeMediaFrame
          className="fs-cart-line__idol-media"
          media={props.idol.media}
        />
      </div>
      <div className="fs-cart-line__content">
        <h3 className="fs-cart-line__title">
          {linkedOrPlain(props.gift.title, props.gift.href)}
        </h3>
        {props.gift.variantLabel === undefined ? null : (
          <p className="fs-cart-line__variant">{props.gift.variantLabel}</p>
        )}
        <p className="fs-cart-line__idol">
          <span>{props.idol.contextLabel}</span>{" "}
          <strong>{linkedOrPlain(props.idol.name, props.idol.href)}</strong>
        </p>
        <div className="fs-cart-line__facts">
          {quantityControl ?? (
            <p>
              <span>{props.quantity.label}</span>{" "}
              <data value={String(props.quantity.value)}>
                {props.quantity.value}
              </data>
            </p>
          )}
          <Price {...props.lineTotal} />
        </div>
        <Status
          className="fs-cart-line__message"
          data-private-message={props.message.kind}
          tone={props.message.kind === "present" ? "success" : "neutral"}
        >
          {props.message.label}
        </Status>
        {props.availability === undefined ? null : (
          <Status
            tone={
              props.availability.kind === "available" ? "success" : "warning"
            }
          >
            {props.availability.label}
          </Status>
        )}
      </div>
      {props.editAction === undefined && removeControl === undefined ? null : (
        <div className="fs-cart-line__actions">
          {props.editAction === undefined ? null : (
            <Link href={props.editAction.href} variant="standalone">
              {props.editAction.label}
            </Link>
          )}
          {removeControl}
        </div>
      )}
    </article>
  );
}

export function CartLine(props: CartLineProps): ReactElement {
  if (props.state !== "ready") {
    return (
      <article
        className="fs-cart-line fs-cart-line--state"
        data-fs-composite="cart-line"
        data-render-state={props.state}
      >
        <CompositeStateContent state={props} />
      </article>
    );
  }

  return <CartLineLayout props={props} />;
}
