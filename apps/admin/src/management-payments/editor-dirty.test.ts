import { expect, test } from "vitest";
const editor = await import("./editor");
test("payment edits compare actual field values including added and removed rows", () => {
  expect("paymentEditorFingerprint" in editor).toBe(true);
  const fingerprint = (
    editor as unknown as {
      paymentEditorFingerprint: (data: FormData) => string;
    }
  ).paymentEditorFingerprint;
  const original = new FormData();
  original.append("channel.0.name", "Card");
  const same = new FormData();
  same.append("channel.0.name", "Card");
  expect(fingerprint(same)).toBe(fingerprint(original));
  same.set("channel.0.name", "Cards");
  expect(fingerprint(same)).not.toBe(fingerprint(original));
  same.set("channel.0.name", "Card");
  expect(fingerprint(same)).toBe(fingerprint(original));
  same.append("route.0.account", "account");
  expect(fingerprint(same)).not.toBe(fingerprint(original));
  same.delete("route.0.account");
  expect(fingerprint(same)).toBe(fingerprint(original));
});
test("replacing a route with identical fields still changes its persisted rule key", () => {
  const fingerprint = editor.paymentEditorFingerprint as (
    data: FormData,
    ruleKeys?: string[],
  ) => string;
  const fields = new FormData();
  fields.append("route.0.account", "same-account");
  expect(fingerprint(fields, ["original-rule"])).not.toBe(
    fingerprint(fields, ["replacement-rule"]),
  );
});
