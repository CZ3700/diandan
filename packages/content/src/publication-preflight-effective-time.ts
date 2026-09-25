import type {
  PublicationPreflightContext,
  PublicationPreflightIssue,
} from "@fan-support/contracts";
import {
  comparePreflightTime as compare,
  preflightIssue,
  sameId,
} from "./publication-preflight-shared.js";
function effective(at: string, from: string, until?: string): boolean {
  return (
    compare(at, from) >= 0 && (until === undefined || compare(at, until) < 0)
  );
}
function earliestEnd(
  left: string | undefined,
  right: string | undefined,
): string | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return compare(left, right) < 0 ? left : right;
}
/** Replace only legacy millisecond time decisions; immutable old schemas and validators stay intact. */
export function validatePreflightEffectiveTime(
  context: PublicationPreflightContext,
): PublicationPreflightIssue[] {
  const candidate = context.candidate;
  const issues: PublicationPreflightIssue[] = [];
  if (candidate.objectKind === "POLICY") {
    if (
      compare(candidate.revision.effectiveAt, candidate.revision.createdAt) < 0
    )
      issues.push(
        preflightIssue("POLICY_EFFECTIVE_TIME_INVALID", [
          "revision",
          "effectiveAt",
        ]),
      );
    if (compare(candidate.revision.effectiveAt, context.evaluatedAt) > 0)
      issues.push(
        preflightIssue("POLICY_NOT_EFFECTIVE", ["revision", "effectiveAt"]),
      );
  }
  if (candidate.objectKind !== "GIFT") return issues;
  const intervals = candidate.prices.flatMap((price, index) => {
    const books = candidate.priceBooks.filter(
      (book) =>
        sameId(book.id, price.priceBookId) &&
        book.revision === price.priceBookRevision,
    );
    if (books.length !== 1 || books[0]!.status !== "PUBLISHED") return [];
    const book = books[0]!;
    const start =
      compare(price.validFrom, book.validFrom) >= 0
        ? price.validFrom
        : book.validFrom;
    const end = earliestEnd(price.validUntil, book.validUntil);
    return [{ index, price, book, start, end }];
  });
  for (const [index, variant] of candidate.variants.entries()) {
    if (variant.status === "archived") continue;
    const prices = intervals.filter((item) =>
      sameId(item.price.giftVariantId, variant.id),
    );
    if (
      prices.length > 0 &&
      !prices.some((item) =>
        effective(context.evaluatedAt, item.start, item.end),
      )
    )
      issues.push(
        preflightIssue("PRICE_NOT_EFFECTIVE", ["variants", index, "prices"]),
      );
  }
  for (const [index, left] of intervals.entries())
    for (const right of intervals.slice(index + 1)) {
      if (
        !sameId(left.price.giftVariantId, right.price.giftVariantId) ||
        left.book.market !== right.book.market ||
        left.book.currency !== right.book.currency
      )
        continue;
      const start =
        compare(left.start, right.start) >= 0 ? left.start : right.start;
      const end = earliestEnd(left.end, right.end);
      if (end === undefined || compare(start, end) < 0)
        issues.push(preflightIssue("PRICE_OVERLAP", ["prices", right.index]));
    }
  return issues;
}
