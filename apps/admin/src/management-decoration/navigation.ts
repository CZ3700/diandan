export function canLeaveDecoration(
  state: { busy: boolean; dirty: boolean },
  confirm: () => boolean,
): boolean {
  return !state.busy && (!state.dirty || confirm());
}
