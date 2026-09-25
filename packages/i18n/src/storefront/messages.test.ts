import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { IntlMessageFormat } from "intl-messageformat";
import * as entry from "../index.js";

type MessageAst = ReturnType<IntlMessageFormat["getAst"]>;

/** Ignore prose/order/repetition, while retaining each argument's type and branch. */
function messageContract(ast: MessageAst, simpleCardinal: boolean): string[] {
  const nodes = ast.flatMap((node): string[] => {
    if (node.type === 0 || node.type === 7) return []; // Literal text and plural #.
    if (node.type === 5 || node.type === 6) {
      // Languages with only CLDR "other" may express a plain cardinal count.
      // Exact-number branches, offsets, ordinals and nested arguments still matter.
      if (
        simpleCardinal &&
        node.type === 6 &&
        node.pluralType === "cardinal" &&
        node.offset === 0 &&
        Object.entries(node.options).every(
          ([key, option]) =>
            !key.startsWith("=") &&
            messageContract(option.value, simpleCardinal).length === 0,
        )
      )
        return [JSON.stringify({ type: 1, argument: node.value })];
      const other = messageContract(
        node.options["other"]!.value,
        simpleCardinal,
      );
      const options = Object.fromEntries(
        Object.entries(node.options)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(
            ([key, option]) =>
              [key, messageContract(option.value, simpleCardinal)] as const,
          )
          .filter(
            ([key, signature]) =>
              node.type === 5 ||
              key === "other" ||
              key.startsWith("=") ||
              JSON.stringify(signature) !== JSON.stringify(other),
          ),
      );
      return [
        JSON.stringify({
          type: node.type,
          argument: node.value,
          ...(node.type === 6
            ? { pluralType: node.pluralType, offset: node.offset }
            : {}),
          options,
        }),
      ];
    }
    if (node.type === 8)
      return [
        JSON.stringify({
          type: node.type,
          tag: node.value,
          children: messageContract(node.children, simpleCardinal),
        }),
      ];
    return [
      JSON.stringify({
        type: node.type,
        argument: node.value,
        ...("style" in node ? { style: node.style ?? null } : {}),
      }),
    ];
  });
  return [...new Set(nodes)].sort();
}

function assertMessageContract(
  source: string,
  translation: string,
  locale: string,
) {
  const categories = new Intl.PluralRules(locale).resolvedOptions()
    .pluralCategories;
  const simpleCardinal = categories.length === 1 && categories[0] === "other";
  expect(
    messageContract(
      new IntlMessageFormat(translation, locale).getAst(),
      simpleCardinal,
    ),
  ).toEqual(
    messageContract(
      new IntlMessageFormat(source, "en").getAst(),
      simpleCardinal,
    ),
  );
}

describe("storefront ICU contract gate", () => {
  it.each([
    ["Hello {name}", "Hello {person}"],
    ["Wait {seconds, number}", "Wait {seconds}"],
    [
      "{kind, select, gift {Gift} other {Other}}",
      "{kind, select, other {Other}}",
    ],
    [
      "{count, plural, =0 {None} other {# gifts}}",
      "{count, plural, other {# gifts}}",
    ],
    [
      "{count, plural, other {# gifts}}",
      "{count, plural, offset:1 other {# gifts}}",
    ],
    [
      "{count, plural, other {# gifts}}",
      "{count, selectordinal, other {# gifts}}",
    ],
    [
      "{kind, select, gift {{name}} other {Other}}",
      "{kind, select, gift {Gift} other {{name}}}",
    ],
  ])("rejects semantic drift from %s", (source, translation) => {
    expect(() => assertMessageContract(source, translation, "es")).toThrow();
  });

  it("allows translated word order, repeated arguments and locale-specific plural categories", () => {
    expect(() =>
      assertMessageContract(
        "Hello {name}, {gift}",
        "{gift}: {name}, {name}",
        "zh-CN",
      ),
    ).not.toThrow();
    expect(() =>
      assertMessageContract(
        "{count, plural, one {# gift} other {# gifts}}",
        "{count, plural, other {# 件礼物}}",
        "zh-CN",
      ),
    ).not.toThrow();
    expect(() =>
      assertMessageContract(
        "{count, plural, one {# gift} other {# gifts}}",
        "共 {count} 件礼物",
        "zh-CN",
      ),
    ).not.toThrow();
    expect(() =>
      assertMessageContract(
        "{count, plural, one {# gift} other {# gifts}}",
        "{count, plural, one {# regalo} many {# regalos} other {# regalos}}",
        "es",
      ),
    ).not.toThrow();
  });

  it("rejects malformed ICU syntax", () => {
    expect(() =>
      assertMessageContract(
        "{count, plural, other {# gifts}}",
        "{count, plural, one {Gift}}",
        "en",
      ),
    ).toThrow();
  });

  it.each([
    "{count, plural, =0 {None} other {# gifts}}",
    "{count, plural, offset:1 other {# gifts}}",
    "{count, selectordinal, other {# gifts}}",
    "{count, plural, one {{name}} other {# gifts}}",
  ])(
    "retains meaningful plural structure even without grammatical plural inflection: %s",
    (source) => {
      expect(() =>
        assertMessageContract(source, "{count} 件礼物", "zh-CN"),
      ).toThrow();
    },
  );
});

describe("storefront locale messages", () => {
  it("loads exactly one complete presentation catalog for every public locale", async () => {
    const loader = (entry as unknown as Record<string, unknown>)[
      "loadStorefrontCopy"
    ];
    expect(typeof loader).toBe("function");
    if (typeof loader !== "function") return;
    const source = (await loader("en")) as Record<string, string>;
    for (const locale of SUPPORTED_LOCALES) {
      const copy = (await loader(locale)) as Record<string, string>;
      expect(Object.keys(copy).sort()).toEqual(Object.keys(source).sort());
      expect(
        Object.values(copy).every(
          (value) => typeof value === "string" && value.trim().length > 0,
        ),
      ).toBe(true);
      expect(copy["artistSearchLabel"]).toBeTruthy();
      expect(copy["giftHandover"]).toBeTruthy();
      for (const key of Object.keys(source)) {
        expect(
          () => assertMessageContract(source[key]!, copy[key]!, locale),
          `${locale}:${key}`,
        ).not.toThrow();
      }
    }
  });
});
