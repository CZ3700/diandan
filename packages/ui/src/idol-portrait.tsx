import type { ReactElement } from "react";

import { CompositeMediaFrame } from "./composite-media.js";
import { CompositeStateContent } from "./composite-state.js";
import type { CompositeMedia, CompositeView } from "./composite-types.js";
import { Link } from "./link.js";
import { Status } from "./status.js";

type IdolAvailability =
  | Readonly<{ kind: "accepting"; label: string }>
  | Readonly<{ kind: "unavailable"; label: string }>;

type IdolSelection =
  | Readonly<{
      selectedLabel: string;
      selection: "selected";
    }>
  | Readonly<{
      selectedLabel?: never;
      selection: "unselected";
    }>;

type SelectableIdol = Readonly<{
  availability: Extract<IdolAvailability, { kind: "accepting" }>;
  href: string;
}>;

type UnavailableIdol = Readonly<{
  availability: Extract<IdolAvailability, { kind: "unavailable" }>;
  href?: never;
}>;

type IdolPortraitReadyProps = Readonly<{
  media: CompositeMedia;
  name: string;
}> &
  IdolSelection &
  (SelectableIdol | UnavailableIdol);

export type IdolPortraitProps = CompositeView<IdolPortraitReadyProps>;

function toneForIdol(availability: IdolAvailability): "neutral" | "success" {
  return availability.kind === "accepting" ? "success" : "neutral";
}

export function IdolPortrait(props: IdolPortraitProps): ReactElement {
  if (props.state !== "ready") {
    return (
      <figure
        className="fs-idol-portrait fs-idol-portrait--state"
        data-fs-composite="idol-portrait"
        data-render-state={props.state}
      >
        <CompositeStateContent state={props} />
      </figure>
    );
  }

  return (
    <figure
      className="fs-idol-portrait"
      data-availability={props.availability.kind}
      data-fs-composite="idol-portrait"
      data-render-state="ready"
      data-selection={props.selection}
    >
      <CompositeMediaFrame
        className="fs-idol-portrait__media"
        media={props.media}
      />
      <figcaption className="fs-idol-portrait__caption">
        <h3 className="fs-idol-portrait__name">
          {props.availability.kind === "accepting" ? (
            <Link
              aria-current={props.selection === "selected" ? "true" : undefined}
              href={props.href!}
              variant="standalone"
            >
              {props.name}
            </Link>
          ) : (
            props.name
          )}
        </h3>
        <Status tone={toneForIdol(props.availability)}>
          {props.availability.label}
        </Status>
        {props.selection === "selected" ? (
          <span className="fs-idol-portrait__selected">
            {props.selectedLabel}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}
