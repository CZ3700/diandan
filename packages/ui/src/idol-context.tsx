import type { ReactElement } from "react";

import { CompositeMediaFrame } from "./composite-media.js";
import { CompositeStateContent } from "./composite-state.js";
import type {
  CompositeAction,
  CompositeMedia,
  CompositeView,
} from "./composite-types.js";
import { Link } from "./link.js";
import { Status } from "./status.js";

type IdolContextReadyProps = Readonly<{
  action?: CompositeAction;
  availability: Readonly<{
    kind: "accepting" | "unavailable";
    label: string;
  }>;
  contextLabel: string;
  href?: string;
  media: CompositeMedia;
  name: string;
}>;

export type IdolContextProps = CompositeView<IdolContextReadyProps>;

export function IdolContext(props: IdolContextProps): ReactElement {
  if (props.state !== "ready") {
    return (
      <article
        className="fs-idol-context fs-idol-context--state"
        data-fs-composite="idol-context"
        data-render-state={props.state}
      >
        <CompositeStateContent state={props} />
      </article>
    );
  }

  const accessibleLabel = `${props.contextLabel} ${props.name}`;
  return (
    <article
      aria-label={accessibleLabel}
      className="fs-idol-context"
      data-availability={props.availability.kind}
      data-fs-composite="idol-context"
      data-render-state="ready"
    >
      <CompositeMediaFrame
        className="fs-idol-context__media"
        media={props.media}
      />
      <div className="fs-idol-context__content">
        <p className="fs-idol-context__label">{props.contextLabel}</p>
        <p className="fs-idol-context__name">
          {props.href === undefined ? (
            props.name
          ) : (
            <Link href={props.href} variant="standalone">
              {props.name}
            </Link>
          )}
        </p>
        <Status
          tone={props.availability.kind === "accepting" ? "success" : "neutral"}
        >
          {props.availability.label}
        </Status>
      </div>
      {props.action === undefined ? null : (
        <Link
          className="fs-idol-context__action"
          href={props.action.href}
          variant="standalone"
        >
          {props.action.label}
        </Link>
      )}
    </article>
  );
}
