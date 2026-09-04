import type { ReactElement } from "react";

import { CompositeStateContent } from "./composite-state.js";
import type {
  CompositeAction,
  CompositeResponsiveMedia,
  CompositeView,
} from "./composite-types.js";
import { ResponsiveCompositeMedia } from "./composite-media.js";
import { Link } from "./link.js";

type HeroReadyProps = Readonly<{
  action: CompositeAction;
  description?: string;
  eyebrow: string;
  heading: string;
  media: CompositeResponsiveMedia;
  textTone: "dark" | "light";
}>;

export type HeroProps = CompositeView<HeroReadyProps>;

export function Hero(props: HeroProps): ReactElement {
  if (props.state !== "ready") {
    return (
      <section
        className="fs-hero fs-hero--state"
        data-fs-composite="hero"
        data-render-state={props.state}
      >
        <CompositeStateContent state={props} />
      </section>
    );
  }

  return (
    <section
      className="fs-hero"
      data-fs-composite="hero"
      data-render-state="ready"
      data-text-tone={props.textTone}
    >
      <ResponsiveCompositeMedia media={props.media} />
      <div className="fs-hero__scrim" aria-hidden="true" />
      <div className="fs-hero__content">
        <p className="fs-hero__eyebrow">{props.eyebrow}</p>
        <h1 className="fs-hero__heading">{props.heading}</h1>
        {props.description === undefined ? null : (
          <p className="fs-hero__description">{props.description}</p>
        )}
        <Link
          className="fs-hero__action"
          href={props.action.href}
          variant="standalone"
        >
          {props.action.label}
        </Link>
      </div>
    </section>
  );
}
