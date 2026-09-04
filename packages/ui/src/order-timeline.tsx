import type { ReactElement } from "react";

import { CompositeStateContent } from "./composite-state.js";
import type { CompositeView } from "./composite-types.js";
import { Status, type StatusTone } from "./status.js";

export type OrderTimelineStep = Readonly<{
  description?: string;
  key: string;
  label: string;
  moment?: Readonly<{
    dateTime: string;
    label: string;
  }>;
  state: "attention" | "completed" | "current" | "upcoming";
  stateLabel: string;
}>;

type OrderTimelineReadyProps = Readonly<{
  label: string;
  steps: readonly [OrderTimelineStep, ...OrderTimelineStep[]];
}>;

export type OrderTimelineProps = CompositeView<OrderTimelineReadyProps>;

function validateTimeline(steps: readonly OrderTimelineStep[]): void {
  if (new Set(steps.map((step) => step.key)).size !== steps.length) {
    throw new TypeError("OrderTimeline steps require unique keys.");
  }
  if (steps.filter((step) => step.state === "current").length > 1) {
    throw new TypeError("OrderTimeline allows at most one current step.");
  }
}

function toneForStep(state: OrderTimelineStep["state"]): StatusTone {
  switch (state) {
    case "completed":
      return "success";
    case "attention":
      return "warning";
    case "current":
    case "upcoming":
      return "neutral";
  }
}

export function OrderTimeline(props: OrderTimelineProps): ReactElement {
  if (props.state !== "ready") {
    return (
      <section
        className="fs-order-timeline fs-order-timeline--state"
        data-fs-composite="order-timeline"
        data-render-state={props.state}
      >
        <CompositeStateContent state={props} />
      </section>
    );
  }
  validateTimeline(props.steps);

  return (
    <section
      aria-label={props.label}
      className="fs-order-timeline"
      data-fs-composite="order-timeline"
      data-render-state="ready"
    >
      <ol className="fs-order-timeline__list">
        {props.steps.map((step) => (
          <li
            aria-current={step.state === "current" ? "step" : undefined}
            className="fs-order-timeline__step"
            data-step-state={step.state}
            key={step.key}
          >
            <span aria-hidden="true" className="fs-order-timeline__marker" />
            <div className="fs-order-timeline__content">
              <p className="fs-order-timeline__label">{step.label}</p>
              <Status tone={toneForStep(step.state)}>{step.stateLabel}</Status>
              {step.description === undefined ? null : (
                <p>{step.description}</p>
              )}
              {step.moment === undefined ? null : (
                <time dateTime={step.moment.dateTime}>{step.moment.label}</time>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
