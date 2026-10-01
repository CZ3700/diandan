import BaseGatherer from "lighthouse/core/gather/base-gatherer.js";
import { Audit } from "lighthouse/core/audits/audit.js";

/** Runs inside Lighthouse's measured document, without navigation or DOM mutations. */
export function readAcceptanceContent(
  selector,
  expectedUrl,
  locale,
  requiredSelectors = ["main h1"],
) {
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
        '.storefront-state, [data-artist-directory-status][data-error], [data-artist-directory-status][data-loading="true"]',
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

export class AcceptanceContentAudit extends Audit {
  static get meta() {
    return {
      id: "storefront-content",
      title: "Measured navigation contains the expected storefront content",
      failureTitle:
        "Measured navigation is missing expected storefront content",
      description:
        "Checks the actual Lighthouse document, locale and visible content before accepting its performance sample.",
      requiredArtifacts: ["StorefrontContent"],
    };
  }

  static audit(artifacts) {
    const content = artifacts.StorefrontContent;
    const observed = content?.observed;
    return {
      score:
        content?.schemaVersion === 1 &&
        content.valid === true &&
        observed?.urlMatches === true &&
        observed.localeMatches === true &&
        observed.contentVisible === true &&
        observed.errorVisible === false
          ? 1
          : 0,
      details: { type: "debugdata", content: content ?? null },
    };
  }
}

/** Adds a separate validity category; standard Lighthouse metrics and weights stay intact. */
export function createAcceptanceLighthouseConfig(target, expectedUrl) {
  const requiredSelectors = {
    home: ["#hero-title", "[data-artist-directory] [data-artist-card]"],
    artist: ["#artist-title", "p[data-artist-description][lang]"],
    gift: ["[data-gift-detail] h1"],
  }[target.kind] ?? ["main h1"];
  class AcceptanceContentGatherer extends BaseGatherer {
    meta = { supportedModes: ["navigation"] };

    async getArtifact(context) {
      return context.driver.executionContext.evaluate(readAcceptanceContent, {
        args: [target.selector, expectedUrl, target.locale, requiredSelectors],
        useIsolation: true,
      });
    }
  }

  return {
    extends: "lighthouse:default",
    artifacts: [
      { id: "StorefrontContent", gatherer: new AcceptanceContentGatherer() },
    ],
    audits: [AcceptanceContentAudit],
    categories: {
      storefront: {
        title: "Storefront content validity",
        auditRefs: [{ id: "storefront-content", weight: 1 }],
      },
    },
  };
}
