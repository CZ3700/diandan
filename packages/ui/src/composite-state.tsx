import type { ReactElement } from "react";

import { Link } from "./link.js";
import { Status } from "./status.js";
import type { CompositeUnavailableState } from "./composite-types.js";

export function CompositeStateContent({
  state,
}: Readonly<{ state: CompositeUnavailableState }>): ReactElement {
  if (state.state === "loading") {
    return (
      <div
        aria-busy="true"
        aria-live="polite"
        className="fs-composite-state fs-composite-state--loading"
        role="status"
      >
        <span>{state.label}</span>
        <span aria-hidden="true" className="fs-composite-state__skeleton" />
      </div>
    );
  }

  return (
    <div
      className={`fs-composite-state fs-composite-state--${state.state}`}
      data-state-kind={state.state}
    >
      <Status tone={state.state === "error" ? "danger" : "neutral"}>
        {state.title}
      </Status>
      {state.description === undefined ? null : <p>{state.description}</p>}
      {state.action === undefined ? null : (
        <Link href={state.action.href} variant="standalone">
          {state.action.label}
        </Link>
      )}
    </div>
  );
}
