import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { createAdminClient } from "../workspace/client";
import { createPoliciesApi } from "./api";
const subject = await import("./workspace").catch(() => undefined);
test("policy workspace exposes actual catalog selection and registration without placeholder document keys", () => {
  expect(subject?.PoliciesWorkspace).toBeTypeOf("function");
  const html = renderToStaticMarkup(
    createElement(subject!.PoliciesWorkspace, {
      api: createPoliciesApi(createAdminClient(() => "csrf", vi.fn(), vi.fn())),
      locale: "en",
      localeScopes: ["en"],
      permissions: ["content.read", "content.edit", "content.policy.manage"],
      actorId: "reviewer",
      onBusy: vi.fn(),
      onDirtyChange: vi.fn(),
    }),
  );
  expect(html).toContain("Register a policy");
  expect(html).toContain("Policy key");
  expect(html).not.toContain('value="terms"');
  expect(html).not.toContain("Approve all");
});
