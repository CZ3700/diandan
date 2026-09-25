import { z } from "zod";
import type { rumReportSchema } from "./rum.js";

/** Extend the frozen v1 shape without a runtime import cycle or duplicated fields. */
export function createRumReportV2Schema(legacy: typeof rumReportSchema) {
  return legacy
    .extend({
      schemaVersion: z.literal(2),
      integrity: z.strictObject({
        status: z.enum(["CLEAN", "DEGRADED"]),
        quarantinedMeasurementKeys: z.number().int().min(0),
        quarantinedRecords: z.number().int().min(0),
        acceptedRecords: z.number().int().min(0),
      }),
      rows: z.array(
        legacy.shape.rows.element.extend({
          assessment: z.enum([
            "LOCAL_ONLY",
            "INSUFFICIENT",
            "WITHIN_BUDGET",
            "OVER_BUDGET",
            "DEGRADED",
          ]),
        }),
      ),
    })
    .superRefine((report, context) => {
      const { integrity } = report;
      const degraded = integrity.status === "DEGRADED";
      const hasQuarantinedKeys = integrity.quarantinedMeasurementKeys > 0;
      const hasQuarantinedRecords = integrity.quarantinedRecords > 0;
      if (
        report.receivedRecords !==
          integrity.acceptedRecords + integrity.quarantinedRecords ||
        degraded !== hasQuarantinedKeys ||
        degraded !== hasQuarantinedRecords ||
        integrity.quarantinedRecords <
          integrity.quarantinedMeasurementKeys * 2 ||
        report.uniqueMeasurements > integrity.acceptedRecords ||
        (report.uniqueMeasurements === 0) !==
          (integrity.acceptedRecords === 0) ||
        report.rows.reduce((sum, row) => sum + row.count, 0) !==
          report.uniqueMeasurements ||
        report.rows.some((row) => (row.assessment === "DEGRADED") !== degraded)
      )
        context.addIssue({
          code: "custom",
          message: "RUM integrity counts and assessments must agree",
        });
    })
    .meta({
      "x-runtime-invariants": [
        "receivedRecords equals acceptedRecords plus quarantinedRecords",
        "conflicting measurement keys and all their in-window records are quarantined",
        "DEGRADED windows cannot make budget assessments",
        "report counts and row sample totals agree; raw measurement keys are not included",
      ],
    });
}
