import { describe, expect, it } from "vitest";
import { baseContentTargetSchema } from "@fan-support/contracts";
import { createMutationKeys, createRequestEpoch, previewHref } from "./state";

describe("operator client state", () => {
  it("keeps the same idempotency key after an uncertain response and retires it only on success", () => {
    let count = 0;
    const keys = createMutationKeys(() => `key-${++count}`);
    expect(keys.forCommand("save", { revision: 1 })).toBe("key-1");
    expect(keys.forCommand("save", { revision: 1 })).toBe("key-1");
    expect(keys.forCommand("save", { revision: 2 })).toBe("key-2");
    keys.succeeded("save", { revision: 1 });
    expect(keys.forCommand("save", { revision: 1 })).toBe("key-3");
  });
  it("invalidates responses when the operator changes selection", () => {
    const epoch = createRequestEpoch();
    const old = epoch.next();
    const current = epoch.next();
    expect(epoch.isCurrent(old)).toBe(false);
    expect(epoch.isCurrent(current)).toBe(true);
  });
  it("preview links contain only typed owner, revision, locale and viewport", () => {
    const href = previewHref(
      baseContentTargetSchema.parse({
        owner: { kind: "IDOL", idolId: "10000000-0000-4000-8000-000000000001" },
        revisionId: "10000000-0000-4000-8000-000000000002",
        locale: "ja",
      }),
      "mobile",
    );
    expect(href).toContain("/ja/preview?");
    expect(href).not.toMatch(/token|session|csrf/i);
    expect(new URL(href, "http://localhost").searchParams.get("viewport")).toBe(
      "mobile",
    );
  });
});
