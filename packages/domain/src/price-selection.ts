import {
  priceSelectionInputSchema,
  type PriceSelectionDecision,
  type PriceSelectionInput,
} from "@fan-support/contracts";

type PriceRejection = Extract<PriceSelectionDecision, { kind: "REJECTED" }>;

function rejected(code: PriceRejection["code"]): PriceRejection {
  return { schemaVersion: 1 as const, kind: "REJECTED" as const, code };
}

function isEffectiveAt(
  evaluatedAt: number,
  validFrom: string,
  validUntil: string | undefined,
): boolean {
  return (
    Date.parse(validFrom) <= evaluatedAt &&
    (validUntil === undefined || evaluatedAt < Date.parse(validUntil))
  );
}

export function selectEffectivePrice(input: unknown): PriceSelectionDecision {
  const parsed = priceSelectionInputSchema.safeParse(input);
  if (!parsed.success) {
    return rejected("PRICE_DATA_INVALID");
  }
  const value: PriceSelectionInput = parsed.data;
  const booksByRevision = new Map<
    string,
    PriceSelectionInput["priceBooks"][number]
  >();
  for (const book of value.priceBooks) {
    const key = `${book.id.toLowerCase()}:${book.revision}`;
    if (booksByRevision.has(key)) {
      return rejected("PRICE_DATA_INVALID");
    }
    booksByRevision.set(key, book);
  }
  const priceRevisions = new Set<string>();
  for (const price of value.prices) {
    const key = `${price.id.toLowerCase()}:${price.revision}`;
    if (priceRevisions.has(key)) {
      return rejected("PRICE_DATA_INVALID");
    }
    priceRevisions.add(key);
  }

  const instant = Date.parse(value.evaluatedAt);
  const matches = value.prices.filter((price) => {
    if (
      price.giftVariantId.toLowerCase() !== value.giftVariantId.toLowerCase()
    ) {
      return false;
    }
    const book = booksByRevision.get(
      `${price.priceBookId.toLowerCase()}:${price.priceBookRevision}`,
    );
    return (
      book?.status === "PUBLISHED" &&
      book.market === value.market &&
      book.currency === value.currency &&
      isEffectiveAt(instant, book.validFrom, book.validUntil) &&
      isEffectiveAt(instant, price.validFrom, price.validUntil)
    );
  });
  if (matches.length === 0) {
    return rejected("PRICE_NOT_FOUND");
  }
  if (matches.length !== 1) {
    return rejected("PRICE_AMBIGUOUS");
  }
  const selected = matches[0]!;
  return {
    schemaVersion: 1 as const,
    kind: "SELECTED" as const,
    priceId: selected.id,
    priceRevision: selected.revision,
    priceBookId: selected.priceBookId,
    priceBookRevision: selected.priceBookRevision,
    unitAmountMinor: selected.unitAmountMinor,
  };
}
