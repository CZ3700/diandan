export type TransitionEffect = Readonly<{
  type: string;
}>;

export type TransitionDecision<State extends string> =
  | Readonly<{
      schemaVersion: 1;
      decision: "APPLIED";
      from: State;
      to: State;
      reasonCode: string;
      effects: readonly TransitionEffect[];
    }>
  | Readonly<{
      schemaVersion: 1;
      decision: "NOOP";
      from: State;
      to: State;
      reasonCode: "ALREADY_APPLIED";
      effects: readonly [];
    }>
  | Readonly<{
      schemaVersion: 1;
      decision: "REJECTED";
      from: State;
      to: State;
      reasonCode: string;
      effects: readonly [];
    }>
  | Readonly<{
      schemaVersion: 1;
      decision: "CONFLICT";
      from: State;
      to: State;
      reasonCode: string;
      effects: readonly [];
    }>;

export function appliedTransition<State extends string>(
  from: State,
  to: State,
  reasonCode: string,
  effects: readonly TransitionEffect[],
): TransitionDecision<State> {
  return {
    schemaVersion: 1,
    decision: "APPLIED",
    from,
    to,
    reasonCode,
    effects,
  };
}

export function noopTransition<State extends string>(
  state: State,
): TransitionDecision<State> {
  return {
    schemaVersion: 1,
    decision: "NOOP",
    from: state,
    to: state,
    reasonCode: "ALREADY_APPLIED",
    effects: [],
  };
}

export function rejectedTransition<State extends string>(
  from: State,
  to: State,
  reasonCode: string,
): TransitionDecision<State> {
  return {
    schemaVersion: 1,
    decision: "REJECTED",
    from,
    to,
    reasonCode,
    effects: [],
  };
}

export function conflictingTransition<State extends string>(
  from: State,
  to: State,
  reasonCode: string,
): TransitionDecision<State> {
  return {
    schemaVersion: 1,
    decision: "CONFLICT",
    from,
    to,
    reasonCode,
    effects: [],
  };
}
