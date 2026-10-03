type Closeable = { close(): Promise<void> };

export type PersistenceLeases<Persistence extends Closeable> = Readonly<{
  /** A borrower's view whose close() returns only its own hold. */
  lease(): Persistence;
  /** Returns the owner's hold; the pool closes once every hold is returned. */
  release(): Promise<void>;
}>;

/** One pool per role. Lifecycle hooks may stop in any order, so the last returned hold closes the pool. */
export function createPersistenceLeases<Persistence extends Closeable>(
  persistence: Persistence,
): PersistenceLeases<Persistence> {
  let holds = 1;
  let ownerRelease: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  const returnHold = (): Promise<void> => {
    holds -= 1;
    if (holds === 0)
      closing = Promise.resolve().then(() => persistence.close());
    return closing ?? Promise.resolve();
  };
  return Object.freeze({
    lease(): Persistence {
      if (ownerRelease !== undefined)
        throw new TypeError("Shared persistence is shutting down");
      holds += 1;
      let returned: Promise<void> | undefined;
      return {
        ...persistence,
        close: () => (returned ??= returnHold()),
      };
    },
    release: () => (ownerRelease ??= returnHold()),
  });
}
