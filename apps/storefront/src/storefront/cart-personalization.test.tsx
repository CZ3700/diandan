import { describe, expect, it } from "vitest";
import {
  cartPersonalization,
  validCartDraft,
  emptyCartDraft,
} from "./cart-personalization";
describe("private form Unicode and replacement semantics", () => {
  it("allows 280 emoji codepoints without truncating or normalizing the original", () => {
    const draft = { ...emptyCartDraft("ja"), fanMessage: "🎁".repeat(280) };
    expect(validCartDraft(draft)).toBe(true);
    expect(cartPersonalization(draft).fanMessage).toBe(draft.fanMessage);
    expect(
      validCartDraft({ ...draft, fanMessage: draft.fanMessage + "🎁" }),
    ).toBe(false);
  });
  it("preserves declared und and omits cleared fields for full replacement", () => {
    expect(
      cartPersonalization({
        ...emptyCartDraft("en"),
        fanMessageLocale: "und",
        displayName: "old value",
      }),
    ).toEqual({ displayMode: "anonymous", fanMessageLocale: "und" });
    expect(
      validCartDraft({
        ...emptyCartDraft("en"),
        displayMode: "nickname",
        displayName: "🎁".repeat(40),
      }),
    ).toBe(true);
    expect(
      validCartDraft({
        ...emptyCartDraft("en"),
        displayMode: "nickname",
        displayName: "🎁".repeat(41),
      }),
    ).toBe(false);
  });
});
