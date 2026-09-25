import { expect, test } from "vitest";

type SafeParseResult = Readonly<{ success: boolean; data?: unknown }>;
type Schema = Readonly<{
  safeParse: (value: unknown) => SafeParseResult;
}>;

async function loadLocaleModule() {
  return import("./locale.js") as Promise<
    Readonly<{
      DEFAULT_LOCALE: unknown;
      LOCALE_NATIVE_NAMES: unknown;
      SUPPORTED_LOCALES: unknown;
      localeContextSchema?: Schema;
      parseSupportedLocale?: (value: unknown) => unknown;
      supportedLocaleSchema?: Schema;
    }>
  >;
}

test("owns the exact ordered launch locale contract", async () => {
  const localeModule = await loadLocaleModule().catch(() => undefined);

  expect(localeModule, "locale contract module must exist").toBeDefined();
  expect(localeModule?.SUPPORTED_LOCALES).toEqual([
    "en",
    "zh-CN",
    "th",
    "vi",
    "ja",
    "es",
    "pt",
  ]);
  expect(localeModule?.DEFAULT_LOCALE).toBe("en");
  expect(localeModule?.LOCALE_NATIVE_NAMES).toEqual({
    en: "English",
    "zh-CN": "简体中文",
    th: "ไทย",
    vi: "Tiếng Việt",
    ja: "日本語",
    es: "Español",
    pt: "Português",
  });
  expect(Object.isFrozen(localeModule?.SUPPORTED_LOCALES)).toBe(true);
  expect(Object.isFrozen(localeModule?.LOCALE_NATIVE_NAMES)).toBe(true);
});

test("normalizes one BCP 47 tag before applying the launch allowlist", async () => {
  const localeModule = await loadLocaleModule();

  expect(
    localeModule.parseSupportedLocale,
    "locale parser must be exported",
  ).toBeTypeOf("function");

  const parse = localeModule.parseSupportedLocale as (
    value: unknown,
  ) => unknown;
  expect(parse("EN")).toBe("en");
  expect(parse("zh-cn")).toBe("zh-CN");
  expect(parse("es-MX")).toBeUndefined();
  expect(parse("en-US,en;q=0.9")).toBeUndefined();
  expect(parse(" en ")).toBeUndefined();
  expect(parse(7)).toBeUndefined();
});

test("keeps locale context strict, versioned, and separate from commerce", async () => {
  const localeModule = await loadLocaleModule();

  expect(
    localeModule.supportedLocaleSchema,
    "SupportedLocale Zod schema must be exported",
  ).toBeDefined();
  expect(
    localeModule.localeContextSchema,
    "LocaleContext Zod schema must be exported",
  ).toBeDefined();

  const supportedLocaleSchema = localeModule.supportedLocaleSchema as Schema;
  const localeContextSchema = localeModule.localeContextSchema as Schema;
  const validContext = {
    schemaVersion: 1,
    requestedLocale: "es",
    resolvedLocale: "en",
    fallbackUsed: true,
    translationRevision: "revision-17",
  };

  expect(supportedLocaleSchema.safeParse("pt").success).toBe(true);
  expect(supportedLocaleSchema.safeParse("en-XA").success).toBe(false);
  expect(localeContextSchema.safeParse(validContext)).toMatchObject({
    success: true,
    data: validContext,
  });

  for (const invalidContext of [
    { ...validContext, schemaVersion: 2 },
    { ...validContext, requestedLocale: "en-XA" },
    { ...validContext, resolvedLocale: "es", fallbackUsed: true },
    { ...validContext, resolvedLocale: "pt", fallbackUsed: true },
    { ...validContext, fallbackUsed: false },
    { ...validContext, market: "US" },
    { ...validContext, country: "US" },
    { ...validContext, currency: "USD" },
    { ...validContext, paymentProvider: "provider-a" },
  ]) {
    expect(localeContextSchema.safeParse(invalidContext).success).toBe(false);
  }
});
