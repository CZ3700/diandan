import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
  SUPPORTED_LOCALES,
  type ManagementCenterOperation,
} from "@fan-support/contracts";
import type { ManagementApi } from "./api";
import { managementCopy } from "./copy";
import { OperationProgress } from "./operation-progress";

const failed = (retryable: boolean): ManagementCenterOperation => ({
  operationId: "00000000-0000-4000-8000-000000000001",
  version: 2,
  kind: "SAVE_ARTIST",
  sourceLocale: "en",
  status: "FAILED",
  targetId: null,
  updatedAt: "2026-09-29T00:00:00.000Z",
  result: null,
  failure: { code: "STALE_VERSION", retryable },
});
const api = {} as ManagementApi;

it("offers to dismiss a failure that cannot be retried, in every language", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const copy = managementCopy(locale);
    const html = renderToStaticMarkup(
      <OperationProgress
        api={api}
        locale={locale}
        operation={failed(false)}
        onChange={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(html).toContain(copy.conflict);
    expect(html).toContain("data-management-dismiss");
    expect(html).toContain(copy.dismiss);
    expect(html).not.toContain("data-management-retry");
  }
});
it("keeps retry for a retryable failure and never offers dismiss there", () => {
  const html = renderToStaticMarkup(
    <OperationProgress
      api={api}
      locale="en"
      operation={failed(true)}
      onChange={() => {}}
      onDismiss={() => {}}
    />,
  );
  expect(html).toContain("data-management-retry");
  expect(html).not.toContain("data-management-dismiss");
});
