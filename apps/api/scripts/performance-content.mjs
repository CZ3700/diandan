import BaseGatherer from "lighthouse/core/gather/base-gatherer.js";
import { Audit } from "lighthouse/core/audits/audit.js";
import { createAcceptanceLighthouseConfig } from "./storefront-acceptance-content.mjs";

export function performanceRequiredContent(kind) {
  if (kind === "home")
    return [
      "#hero-title",
      "[data-artist-card]",
      "[data-gift-browse] [data-gift-card]",
    ];
  if (kind === "artist") return ["#artist-title", ".storefront-story [lang]"];
  if (kind === "gift") return ["[data-gift-detail] h1"];
  if (kind === "gifts" || kind === "gift-browse")
    return ["main h1", "[data-gift-card]"];
  if (kind === "artists") return ["main h1", "[data-artist-card]"];
  return ["main h1"];
}

/** Serializable read-only browser function; checks the measured document, including new homepage gifts. */
export function readPerformanceContent({
  selector,
  expectedUrl,
  locale,
  requiredSelectors,
}) {
  const visible = (element) =>
    element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const observed = {
    urlMatches: globalThis.location.href === expectedUrl,
    localeMatches: globalThis.document.documentElement.lang === locale,
    contentVisible:
      [...globalThis.document.querySelectorAll(selector)].some(visible) &&
      requiredSelectors.every((required) =>
        [...globalThis.document.querySelectorAll(required)].some(
          (element) =>
            visible(element) && element.textContent.trim().length > 0,
        ),
      ),
    errorVisible: [
      ...globalThis.document.querySelectorAll(
        '.storefront-state, [data-artist-directory-status][data-error], [data-artist-directory-status][data-loading="true"], [data-gift-browse] [data-gift-retry], [data-gift-empty], [data-gift-query-recovery]',
      ),
    ].some(visible),
  };
  return {
    schemaVersion: 1,
    observed,
    valid:
      observed.urlMatches &&
      observed.localeMatches &&
      observed.contentVisible &&
      !observed.errorVisible,
  };
}

export class PerformanceContentAudit extends Audit {
  static get meta() {
    return {
      id: "performance-current-content",
      title: "Current storefront content is present in the measured navigation",
      failureTitle: "Current storefront content is missing",
      description:
        "Additive P6-03 content guard including homepage gifts; does not alter standard metric scoring.",
      requiredArtifacts: ["PerformanceCurrentContent"],
    };
  }
  static audit(artifacts) {
    const content = artifacts.PerformanceCurrentContent;
    return {
      score:
        content?.schemaVersion === 1 &&
        content.valid === true &&
        content.observed?.urlMatches === true &&
        content.observed.localeMatches === true &&
        content.observed.contentVisible === true &&
        content.observed.errorVisible === false
          ? 1
          : 0,
      details: { type: "debugdata", content: content ?? null },
    };
  }
}

export function createPerformanceLighthouseConfig(target, expectedUrl) {
  const original = createAcceptanceLighthouseConfig(target, expectedUrl);
  class CurrentContentGatherer extends BaseGatherer {
    meta = { supportedModes: ["navigation"] };
    async getArtifact(context) {
      return context.driver.executionContext.evaluate(readPerformanceContent, {
        args: [
          {
            selector: target.selector,
            expectedUrl,
            locale: target.locale,
            requiredSelectors: performanceRequiredContent(target.kind),
          },
        ],
        useIsolation: true,
      });
    }
  }
  return {
    ...original,
    artifacts: [
      ...original.artifacts,
      {
        id: "PerformanceCurrentContent",
        gatherer: new CurrentContentGatherer(),
      },
    ],
    audits: [...original.audits, PerformanceContentAudit],
    categories: {
      ...original.categories,
      storefront: {
        ...original.categories.storefront,
        auditRefs: [
          ...original.categories.storefront.auditRefs,
          { id: "performance-current-content", weight: 1 },
        ],
      },
    },
  };
}
