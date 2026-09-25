import {
  RUM_ENDPOINT,
  type RumIntake,
  type RumContext,
} from "@fan-support/contracts/rum-browser";
import type { SupportedLocale } from "@fan-support/contracts";
import type { MetricType } from "web-vitals";

type MetricSubscription = (callback: (metric: MetricType) => void) => void;
type RumRuntime = Readonly<{
  documentIdentity: object;
  pathname: () => string;
  viewportWidth: () => number;
  automated: boolean;
  random: () => number;
  uuid: () => string;
  load: () => Promise<{
    onLCP: MetricSubscription;
    onINP: MetricSubscription;
    onCLS: MetricSubscription;
  }>;
  send: (measurement: RumIntake) => void;
}>;
const started = new WeakSet<object>();
const navigationTypes = new Set([
  "navigate",
  "reload",
  "back-forward",
  "back-forward-cache",
  "prerender",
  "restore",
]);
function pageFamily(pathname: string): RumContext["page"] | undefined {
  const parts = pathname.split("/");
  if (parts.length === 2 && parts[1]) return "home";
  if (parts.length === 3) {
    switch (parts[2]) {
      case "idols":
        return "idols";
      case "gifts":
        return "gifts";
      case "cart":
        return "cart";
      case "checkout":
        return "checkout";
    }
  }
  if (parts.length === 4 && parts[3]) {
    switch (parts[2]) {
      case "idols":
        return "idol";
      case "gifts":
        return "gift";
      case "policies":
        return "policy";
      case "orders":
      case "thank-you":
        return "order";
      case "checkout":
        return parts[3] === "return" ? "checkout" : undefined;
    }
  }
  return undefined;
}

export async function startRum(
  config: Readonly<{ locale: SupportedLocale; samplePermille: number }>,
  runtime: RumRuntime,
): Promise<void> {
  if (started.has(runtime.documentIdentity)) return;
  started.add(runtime.documentIdentity);
  const initialPath = runtime.pathname();
  const page = pageFamily(initialPath);
  if (
    config.samplePermille <= 0 ||
    initialPath.split("/")[1] !== config.locale ||
    page === undefined ||
    runtime.random() * 1000 >= config.samplePermille
  )
    return;
  const context: RumContext = {
    locale: config.locale,
    page,
    viewport: runtime.viewportWidth() < 768 ? "mobile" : "desktop",
    automation: runtime.automated ? "automated" : "browser",
  };
  const measurements = new Map<
    string,
    { key: string; revision: number; context: RumContext }
  >();
  try {
    const vitals = await runtime.load();
    const report = (metric: MetricType): void => {
      try {
        if (
          (metric.navigationType === "back-forward-cache" &&
            runtime.pathname() !== initialPath) ||
          pageFamily(runtime.pathname()) === undefined ||
          !["LCP", "INP", "CLS"].includes(metric.name) ||
          !Number.isFinite(metric.value) ||
          metric.value < 0 ||
          metric.value > (metric.name === "CLS" ? 100 : 86_400_000) ||
          !navigationTypes.has(metric.navigationType)
        )
          return;
        const state = measurements.get(metric.id) ?? {
          key: runtime.uuid(),
          revision: 0,
          context:
            metric.navigationType === "back-forward-cache"
              ? {
                  ...context,
                  viewport:
                    runtime.viewportWidth() < 768 ? "mobile" : "desktop",
                }
              : context,
        };
        if (
          state.revision >= 1000 ||
          (measurements.size >= 256 && !measurements.has(metric.id))
        )
          return;
        state.revision++;
        measurements.set(metric.id, state);
        runtime.send({
          schemaVersion: 1,
          context: state.context,
          metric: {
            name: metric.name as RumIntake["metric"]["name"],
            value: metric.value,
            measurementKey: state.key,
            revision: state.revision,
            navigationType:
              metric.navigationType as RumIntake["metric"]["navigationType"],
          },
        });
      } catch {
        /* Observability cannot block a user action or expose metric entries. */
      }
    };
    vitals.onLCP(report);
    vitals.onINP(report);
    vitals.onCLS(report);
  } catch {
    /* A missing optional telemetry chunk must not interrupt shopping. */
  }
}

export function startBrowserRum(
  config: Readonly<{ locale: SupportedLocale; samplePermille: number }>,
): Promise<void> {
  return startRum(config, {
    documentIdentity: document,
    pathname: () => window.location.pathname,
    viewportWidth: () => window.innerWidth,
    automated: navigator.webdriver === true,
    random: Math.random,
    uuid: () => crypto.randomUUID(),
    load: () => import("web-vitals"),
    send: (measurement) => {
      void fetch(RUM_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(measurement),
        keepalive: true,
        credentials: "omit",
        referrerPolicy: "no-referrer",
        cache: "no-store",
      })
        .then(async (response) => {
          // Consume only the empty acknowledgement so its completion stays observable.
          if (response.status === 204) await response.arrayBuffer();
        })
        .catch(() => {});
    },
  });
}
