import type { BaseContentTarget } from "@fan-support/contracts";

export function createMutationKeys(
  random: () => string = () => crypto.randomUUID(),
) {
  const pending = new Map<string, string>();
  const fingerprint = (operation: string, command: unknown) =>
    JSON.stringify([operation, command]);
  return {
    forCommand(operation: string, command: unknown): string {
      const fingerprintValue = fingerprint(operation, command);
      const current = pending.get(fingerprintValue);
      if (current) return current;
      const key = random();
      pending.set(fingerprintValue, key);
      return key;
    },
    succeeded(operation: string, command: unknown) {
      pending.delete(fingerprint(operation, command));
    },
    clear() {
      pending.clear();
    },
  };
}
export function createRequestEpoch() {
  let epoch = 0;
  return { next: () => ++epoch, isCurrent: (value: number) => epoch === value };
}
export function previewHref(
  target: BaseContentTarget,
  viewport: "mobile" | "desktop",
): string {
  const search = new URLSearchParams({
    owner: JSON.stringify(target.owner),
    revision: target.revisionId,
    viewport,
  });
  return `/${target.locale}/preview?${search.toString()}`;
}
