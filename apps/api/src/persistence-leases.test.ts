import { expect, test, vi } from "vitest";

import { createPersistenceLeases } from "./persistence-leases.js";

function persistence() {
  return { marker: "shared", close: vi.fn(async () => undefined) };
}

test("the pool closes exactly once after the owner and every borrower return their holds, in any order", async () => {
  const shared = persistence();
  const leases = createPersistenceLeases(shared);
  const first = leases.lease();
  const second = leases.lease();
  expect(first.marker).toBe("shared");
  await leases.release();
  await first.close();
  await first.close();
  expect(shared.close).not.toHaveBeenCalled();
  await second.close();
  await leases.release();
  expect(shared.close).toHaveBeenCalledTimes(1);
});

test("an unborrowed pool closes on the owner release and refuses new borrowers after shutdown begins", async () => {
  const shared = persistence();
  const leases = createPersistenceLeases(shared);
  await leases.release();
  expect(shared.close).toHaveBeenCalledTimes(1);
  expect(() => leases.lease()).toThrow("Shared persistence is shutting down");
});

test("the last returned hold observes the real close failure", async () => {
  const shared = {
    close: vi.fn(async () => {
      throw new Error("pool end failed");
    }),
  };
  const leases = createPersistenceLeases(shared);
  const borrowed = leases.lease();
  await leases.release();
  await expect(borrowed.close()).rejects.toThrow("pool end failed");
});
