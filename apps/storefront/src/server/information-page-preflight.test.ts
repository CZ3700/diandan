import { NextResponse } from "next/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  createDefaultStorefrontTheme,
  type StorefrontPalette,
} from "@fan-support/contracts";
import {
  DESIGN_TOKEN_CONTRACT,
  FONT_PROFILE_BY_LOCALE,
  STOREFRONT_PALETTE_SCHEMES,
  STOREFRONT_THEME_PALETTES,
} from "@fan-support/design-tokens";

const { readInformation } = vi.hoisted(() => ({
  readInformation: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./public-information-pages", () => ({
  readPublicInformationPage: readInformation,
}));
vi.mock("@fan-support/config/server", () => ({
  resolveInternalApiRuntimeConfig: () => ({
    origin: "https://api.example.invalid",
  }),
}));
vi.mock("./storefront-copy", () => ({
  loadStorefrontCopy: async () => ({
    notFound: "未找到页面",
    contentError: "暂时无法加载",
    contentErrorBody: "请稍后再试 <稍后>",
    artistRetry: "重试",
    navHome: "首页",
  }),
}));
import { informationPagePreflight } from "./information-page-preflight";

const requestId = "51e2a58a-a1aa-4833-aa8d-4daaf11c01e0";
const fetcher = vi.fn<typeof fetch>();
function published(palette: StorefrontPalette = "SAKURA_PINK") {
  return {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "STOREFRONT_THEME",
    source: "PUBLISHED",
    version: 7,
    publicationId: "51e2a58a-a1aa-4833-aa8d-4daaf11c01e1",
    theme: {
      ...createDefaultStorefrontTheme(),
      palette,
      typography: "LARGE",
      density: "COMPACT",
    },
  };
}
const preflight = () =>
  informationPagePreflight(NextResponse.next(), "FAQ", "zh-CN", requestId);

beforeEach(() => {
  readInformation.mockReset().mockResolvedValue({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "NOT_FOUND",
  });
  fetcher
    .mockReset()
    .mockImplementation(async () => Response.json(published()));
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test.each(Object.keys(STOREFRONT_THEME_PALETTES) as StorefrontPalette[])(
  "missing information keeps HTTP 404 and the published %s palette",
  async (palette) => {
    fetcher.mockImplementation(async () => Response.json(published(palette)));
    const response = await preflight();
    const html = await response.text();
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("content-language")).toBe("zh-CN");
    expect(response.headers.get("x-request-id")).toBe(requestId);
    expect(response.headers.has("retry-after")).toBe(false);
    expect(html).toContain('<html lang="zh-CN"');
    expect(html).toContain(`data-storefront-palette="${palette}"`);
    expect(html).toContain(
      `data-storefront-scheme="${STOREFRONT_PALETTE_SCHEMES[palette]}"`,
    );
    expect(html).toContain('data-theme-source="PUBLISHED"');
    expect(html).toContain('data-theme-status="AVAILABLE"');
    expect(html).toContain('data-theme-version="7"');
    expect(html).toContain('data-storefront-typography="LARGE"');
    expect(html).toContain('data-storefront-density="COMPACT"');
    expect(html).toContain(
      `data-font-profile="${FONT_PROFILE_BY_LOCALE["zh-CN"].id}"`,
    );
    expect(html).toContain(FONT_PROFILE_BY_LOCALE["zh-CN"].family);
    for (const [token, value] of Object.entries(
      STOREFRONT_THEME_PALETTES[palette],
    ))
      expect(html).toContain(`${token}:${value}`);
    expect(html).toContain("<h1>未找到页面</h1>");
    expect(html).toContain('<a href="/zh-CN">首页</a>');
    expect(html).not.toContain("<script");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(readInformation).toHaveBeenCalledTimes(1);
  },
);

test("an information outage stays 503 with retry while a readable theme remains published", async () => {
  readInformation.mockResolvedValue({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "CONTENT_UNAVAILABLE",
  });
  const response = await preflight();
  const html = await response.text();
  expect(response.status).toBe(503);
  expect(response.headers.get("retry-after")).toBe("30");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  expect(html).toContain('data-storefront-palette="SAKURA_PINK"');
  expect(html).toContain('data-theme-source="PUBLISHED"');
  expect(html).toContain("<h1>暂时无法加载</h1>");
  expect(html).toContain("请稍后再试 &lt;稍后&gt;");
  expect(html).toContain('<a href="/zh-CN/faq">重试</a>');
});

test.each(["NOT_FOUND", "CONTENT_UNAVAILABLE"])(
  "%s remains truthful when the independent theme service fails",
  async (code) => {
    readInformation.mockResolvedValue({
      schemaVersion: 1,
      outcome: "FAILURE",
      code,
    });
    fetcher.mockRejectedValue(new Error("private backend diagnostic"));
    const response = await preflight();
    const html = await response.text();
    expect(response.status).toBe(code === "NOT_FOUND" ? 404 : 503);
    expect(response.headers.get("retry-after")).toBe(
      code === "NOT_FOUND" ? null : "30",
    );
    expect(html).toContain('data-theme-source="FALLBACK"');
    expect(html).toContain('data-theme-status="UNAVAILABLE"');
    expect(html).not.toContain("data-theme-version");
    expect(html).toContain(
      `--color-bg:${DESIGN_TOKEN_CONTRACT.values["--color-bg"]}`,
    );
    expect(html).not.toContain("private backend diagnostic");
    expect(readInformation).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);

test("a stalled appearance read uses the existing one-second bound and returns a no-script fallback", async () => {
  vi.useFakeTimers();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const abort = new AbortController();
    setTimeout(() => abort.abort(), ms);
    return abort.signal;
  });
  fetcher.mockImplementation(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new Error("timeout")),
          {
            once: true,
          },
        );
      }),
  );
  const pending = preflight();
  await vi.advanceTimersByTimeAsync(1_000);
  const response = await pending;
  expect(timeout).toHaveBeenCalledWith(1_000);
  expect(response.status).toBe(404);
  const html = await response.text();
  expect(html).toContain('data-theme-source="FALLBACK"');
  expect(html).not.toContain("<script");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("published information continues without another optional theme request", async () => {
  readInformation.mockResolvedValue({
    outcome: "SUCCESS",
    fallbackUsed: false,
  });
  const original = NextResponse.next();
  expect(
    await informationPagePreflight(original, "FAQ", "zh-CN", requestId),
  ).toBe(original);
  expect(original.headers.get("cache-control")).toBe("no-store");
  expect(fetcher).not.toHaveBeenCalled();
});
