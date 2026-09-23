import { z } from "zod";
import { supportedLocaleSchema } from "./locale.js";

export { RUM_ENDPOINT } from "./rum-browser.js";
export const RUM_MAX_BODY_BYTES = 2048;
export const rumPageSchema = z.enum([
  "home",
  "idols",
  "idol",
  "gifts",
  "gift",
  "cart",
  "checkout",
  "order",
  "policy",
]);
export const rumContextSchema = z.strictObject({
  locale: supportedLocaleSchema,
  page: rumPageSchema,
  viewport: z.enum(["mobile", "desktop"]),
  automation: z.enum(["browser", "automated"]),
});
export const rumMetricNameSchema = z.enum(["LCP", "INP", "CLS"]);
const metricBase = {
  measurementKey: z.uuid({ version: "v4" }),
  revision: z.number().int().min(1).max(1000),
  navigationType: z.enum([
    "navigate",
    "reload",
    "back-forward",
    "back-forward-cache",
    "prerender",
    "restore",
  ]),
};
const metricSchema = z.discriminatedUnion("name", [
  z.strictObject({
    ...metricBase,
    name: z.literal("LCP"),
    value: z.number().min(0).max(86_400_000),
  }),
  z.strictObject({
    ...metricBase,
    name: z.literal("INP"),
    value: z.number().min(0).max(86_400_000),
  }),
  z.strictObject({
    ...metricBase,
    name: z.literal("CLS"),
    value: z.number().min(0).max(100),
  }),
]);
export const rumIntakeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  metric: metricSchema,
  context: rumContextSchema,
});
export const rumObservationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  event: z.literal("performance.web_vital"),
  mode: z.enum(["local", "field"]),
  receivedAt: z.iso.datetime(),
  samplePermille: z.number().int().min(1).max(1000),
  measurement: rumIntakeSchema,
});
export const rumReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  windowStart: z.iso.datetime(),
  windowEnd: z.iso.datetime(),
  minimumSamples: z.number().int().min(1),
  receivedRecords: z.number().int().min(0),
  uniqueMeasurements: z.number().int().min(0),
  rows: z.array(
    z.strictObject({
      mode: z.enum(["local", "field"]),
      context: rumContextSchema,
      metric: rumMetricNameSchema,
      samplePermille: z.number().int().min(1).max(1000),
      count: z.number().int().min(1),
      p75: z.number().min(0),
      budgetExclusive: z.number().positive(),
      assessment: z.enum([
        "LOCAL_ONLY",
        "INSUFFICIENT",
        "WITHIN_BUDGET",
        "OVER_BUDGET",
      ]),
    }),
  ),
});
export type RumIntake = z.infer<typeof rumIntakeSchema>;
export type RumObservation = z.infer<typeof rumObservationSchema>;
export type RumReport = z.infer<typeof rumReportSchema>;
export type RumContext = z.infer<typeof rumContextSchema>;
