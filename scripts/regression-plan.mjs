import path from "node:path";

const pnpm = (label, script) => ({
  label,
  command: "corepack",
  args: ["pnpm", script],
});
const suites = [
  {
    id: "quality",
    commands: [
      pnpm("regression-tools", "test:regression-tools"),
      pnpm("ui-composites", "verify:ui-composites:browser"),
      pnpm("ui-motion", "verify:ui-motion:browser"),
      pnpm("repository-check", "check"),
    ],
  },
  {
    id: "catalog",
    commands: [
      pnpm("fallback-seo", "verify:regression:seo"),
      pnpm("storefront-seo-cache", "verify:storefront-acceptance:browser"),
      pnpm("gifts", "verify:gift-storefront:browser"),
      pnpm("management-publication", "verify:management-center"),
    ],
  },
  {
    id: "commerce",
    commands: [
      pnpm("cart", "verify:cart:browser"),
      pnpm("payments", "verify:payment:browser"),
      pnpm("orders", "verify:orders:browser"),
    ],
  },
  {
    id: "operations",
    commands: [
      pnpm("login-permissions", "verify:admin-access:browser"),
      pnpm("order-operations", "verify:admin-orders:browser"),
      pnpm("refunds-disputes", "verify:admin-finance:browser"),
      pnpm(
        "payment-configuration",
        "verify:admin-payment-configuration:browser",
      ),
      pnpm("exception-replay", "verify:admin-exceptions:browser"),
    ],
  },
  {
    id: "journey",
    commands: [pnpm("seven-locale-purchase", "verify:regression:journey")],
  },
];

/** Each entry requires all named suites; passing one related test is insufficient. */
export const regressionRequirements = Object.freeze([
  {
    id: "E2E-01",
    description: "Guest purchase with artist, gift and private intent",
    suites: ["journey"],
  },
  {
    id: "E2E-02",
    description: "Independent recipients in one cart",
    suites: ["commerce"],
  },
  {
    id: "E2E-03",
    description: "Payment failure and cancellation preserve context",
    suites: ["commerce", "journey"],
  },
  {
    id: "E2E-04",
    description: "Canonical preflight rejects stale availability and prices",
    suites: ["quality"],
  },
  {
    id: "E2E-05",
    description: "Early return eventually observes trusted payment evidence",
    suites: ["commerce", "journey"],
  },
  {
    id: "E2E-06",
    description: "Ten identical signed HTTP webhooks have one business effect",
    suites: ["quality"],
  },
  {
    id: "E2E-07",
    description: "Full and partial refunds and disputes update orders",
    suites: ["quality", "operations"],
  },
  {
    id: "E2E-08",
    description: "Paid, preparing and delivered have idempotent notifications",
    suites: ["quality", "operations"],
  },
  {
    id: "E2E-09",
    description:
      "Disabling a channel blocks new payments and preserves existing attempts",
    suites: ["quality", "operations"],
  },
  {
    id: "E2E-10",
    description:
      "Published desktop and mobile poster changes appear within 60 seconds",
    suites: ["catalog"],
  },
  {
    id: "E2E-11",
    description:
      "Seven locales complete the same purchase, order and email journey",
    suites: ["quality", "journey"],
  },
  {
    id: "E2E-12",
    description:
      "Deep-link locale changes preserve commerce and invalid locales fail closed",
    suites: ["commerce", "journey"],
  },
  {
    id: "E2E-13",
    description: "Localized SEO and reciprocal fallback alternate clusters",
    suites: ["catalog"],
  },
  {
    id: "E2E-14",
    description:
      "Locale cache isolation, precise purge and hosted-language-only fallback",
    suites: ["quality", "catalog", "commerce"],
  },
]);

export function planRegression(
  args,
  { root = process.cwd(), now = new Date() } = {},
) {
  let mode = "run",
    selected = "all",
    output;
  if (args.length === 1 && args[0] === "--help") mode = "help";
  else
    for (let index = 0; index < args.length; index++) {
      const argument = args[index];
      if (argument === "--plan" && mode === "run") mode = "plan";
      else if (argument === "--suite" && selected === "all") {
        selected = args[++index];
        if (!suites.some(({ id }) => id === selected))
          throw new Error("Unknown regression suite");
      } else if (argument === "--output" && output === undefined) {
        output = args[++index];
        if (!output?.trim() || output.startsWith("--"))
          throw new Error("A new output directory is required");
      } else throw new Error("Unsupported or repeated regression option");
    }
  return {
    schemaVersion: 1,
    mode,
    complete: selected === "all",
    output: path.resolve(
      root,
      output ??
        `output/checks/p6-01-regression/run-${now.toISOString().replaceAll(":", "-")}`,
    ),
    scope: {
      environment: "LOCAL_TEST",
      remoteCi: false,
      realMoney: false,
      commercialSandbox: false,
      cloudEvidence: false,
      humanAccessibility: false,
    },
    suites: globalThis.structuredClone(
      suites.filter(({ id }) => selected === "all" || selected === id),
    ),
    requirements: globalThis.structuredClone(regressionRequirements),
  };
}

export function regressionCoverage(results) {
  const statuses = new Map(results.map(({ id, status }) => [id, status]));
  const requirements = regressionRequirements.map((entry) => ({
    ...entry,
    status: entry.suites.some((id) => statuses.get(id) === "FAIL")
      ? "FAIL"
      : entry.suites.every((id) => statuses.get(id) === "PASS")
        ? "PASS"
        : "NOT_RUN",
  }));
  return {
    complete: suites.every(({ id }) => statuses.get(id) === "PASS"),
    requirements,
    missingSuites: suites
      .filter(({ id }) => statuses.get(id) !== "PASS")
      .map(({ id }) => id),
  };
}
