// Resolve public runtime exports through storefront's declared workspace dependencies.
export {
  rumObservationSchema,
  rumReportSchema,
  rumReportV2Schema,
} from "@fan-support/contracts/rum";
export {
  aggregateRum,
  aggregateRumV2,
  RUM_MAX_RECORDS,
} from "@fan-support/observability/rum";
