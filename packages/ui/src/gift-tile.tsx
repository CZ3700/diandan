import type { ReactElement } from "react";

import { CompositeMediaFrame } from "./composite-media.js";
import { CompositeStateContent } from "./composite-state.js";
import type {
  CompositeMedia,
  CompositeMoney,
  CompositeView,
} from "./composite-types.js";
import { Link } from "./link.js";
import { Price } from "./price.js";
import { Status, type StatusTone } from "./status.js";

export type GiftAvailability = Readonly<{
  kind: "available" | "low-stock" | "preorder" | "sold-out" | "unavailable";
  label: string;
}>;

type GiftTileReadyProps = Readonly<{
  availability: GiftAvailability;
  href: string;
  media: CompositeMedia;
  price: CompositeMoney;
  subtitle?: string;
  title: string;
}>;

export type GiftTileProps = CompositeView<GiftTileReadyProps>;

function toneForAvailability(kind: GiftAvailability["kind"]): StatusTone {
  switch (kind) {
    case "available":
      return "success";
    case "low-stock":
    case "preorder":
      return "warning";
    case "sold-out":
    case "unavailable":
      return "neutral";
  }
}

export function GiftTile(props: GiftTileProps): ReactElement {
  if (props.state !== "ready") {
    return (
      <article
        className="fs-gift-tile fs-gift-tile--state"
        data-fs-composite="gift-tile"
        data-render-state={props.state}
      >
        <CompositeStateContent state={props} />
      </article>
    );
  }

  return (
    <article
      className="fs-gift-tile"
      data-availability={props.availability.kind}
      data-fs-composite="gift-tile"
      data-render-state="ready"
    >
      <CompositeMediaFrame
        className="fs-gift-tile__media"
        media={props.media}
      />
      <div className="fs-gift-tile__content">
        <h3 className="fs-gift-tile__title">
          <Link href={props.href} variant="standalone">
            {props.title}
          </Link>
        </h3>
        {props.subtitle === undefined ? null : (
          <p className="fs-gift-tile__subtitle">{props.subtitle}</p>
        )}
        <div className="fs-gift-tile__meta">
          <Price {...props.price} />
          <Status tone={toneForAvailability(props.availability.kind)}>
            {props.availability.label}
          </Status>
        </div>
      </div>
    </article>
  );
}
