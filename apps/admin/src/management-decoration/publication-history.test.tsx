import { expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicationHistory } from "./publication-history";
import { navigationCopy } from "./navigation-copy";
import { themeCopy } from "./theme-copy";
for (const kind of ["theme", "navigation"] as const)
  test(`${kind} history keeps current publication protected and exposes independent restore controls`, () => {
    const copy =
      kind === "theme" ? themeCopy("zh-CN") : navigationCopy("zh-CN");
    const html = renderToStaticMarkup(
      <PublicationHistory
        kind={kind}
        locale="zh-CN"
        copy={copy}
        history={{
          entries: [
            {
              publicationId: "current",
              version: 3,
              publishedAt: "2026-09-28T00:00:00Z",
            },
            {
              publicationId: "older",
              version: 1,
              publishedAt: "2026-09-27T00:00:00Z",
            },
          ],
          page: 1,
          hasMore: true,
        }}
        historyFailed={false}
        currentPublicationId="current"
        busy={false}
        canPublish
        restoreId="older"
        onHistoryRetry={vi.fn()}
        onHistoryPage={vi.fn()}
        onRestoreSelect={vi.fn()}
        onRestoreConfirm={vi.fn()}
      />,
    );
    expect(html).toMatch(
      new RegExp(`data-${kind}-restore="current"[^>]*disabled`),
    );
    expect(html).toMatch(
      new RegExp(`data-${kind}-restore="older"(?![^>]*disabled)`),
    );
    expect(html).toContain(`data-${kind}-confirm-restore`);
    expect(html).toContain(copy.restoreConfirm);
    expect(html).toContain(copy.next);
  });
