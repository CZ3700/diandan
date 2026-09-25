import {
  SUPPORTED_LOCALES,
  paymentConfigurationDocumentSchema,
} from "@fan-support/contracts";
import { parsePercentage } from "./model";
const value = (data: FormData, key: string) =>
  String(data.get(key) ?? "").trim();
const integer = (text: string) =>
  /^-?\d+$/.test(text) && Number.isSafeInteger(Number(text))
    ? Number(text)
    : Number.NaN;
const codes = (text: string, uppercase = false) =>
  text
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean)
    .map((code) => (uppercase ? code.toUpperCase() : code));
export function secondsToMilliseconds(text: string) {
  if (!/^\d+(?:\.\d{1,3})?$/.test(text)) return Number.NaN;
  const [whole = "", fraction = ""] = text.split(".");
  const result = Number(whole) * 1000 + Number(fraction.padEnd(3, "0"));
  return Number.isSafeInteger(result) ? result : Number.NaN;
}
export function readPaymentDocument(
  data: FormData,
  channelCount: number,
  ruleKeys: string[],
) {
  const get = (key: string) => value(data, key),
    number = (key: string) => integer(get(key));
  return paymentConfigurationDocumentSchema.safeParse({
    schemaVersion: 1,
    channels: Array.from({ length: channelCount }, (_, i) => {
      const p = `c${i}`;
      return {
        providerAccountId: get(`${p}.account`),
        enabled: data.has(`${p}.enabled`),
        displayOrder: number(`${p}.order`),
        rolloutBasisPoints: parsePercentage(get(`${p}.rollout`)),
        healthPolicy: {
          failureThreshold: number(`${p}.failureThreshold`),
          failureWindowMs: secondsToMilliseconds(get(`${p}.failureWindowMs`)),
          openDurationMs: secondsToMilliseconds(get(`${p}.openDurationMs`)),
          probeLeaseMs: secondsToMilliseconds(get(`${p}.probeLeaseMs`)),
          probeRetryMs: secondsToMilliseconds(get(`${p}.probeRetryMs`)),
        },
        translations: SUPPORTED_LOCALES.flatMap((locale) => {
          const displayName = get(`${p}.${locale}.name`),
            customerHint = get(`${p}.${locale}.hint`);
          return displayName || customerHint
            ? [
                {
                  locale,
                  displayName,
                  customerHint,
                  translatedFromSourceHash: null,
                },
              ]
            : [];
        }),
      };
    }),
    routes: ruleKeys.map((ruleKey, i) => {
      const p = `r${i}`;
      return {
        ruleKey,
        providerAccountId: get(`${p}.account`),
        paymentMethod: get(`${p}.method`),
        enabled: data.has(`${p}.enabled`),
        countries: codes(get(`${p}.countries`), true),
        markets: codes(get(`${p}.markets`)),
        currencies: codes(get(`${p}.currencies`), true),
        minimumAmountMinor: number(`${p}.minimum`),
        maximumAmountMinor: number(`${p}.maximum`),
        priority: number(`${p}.priority`),
        rolloutBasisPoints: parsePercentage(get(`${p}.rollout`)),
        requiredDeviceCapabilities: data.getAll(`${p}.devices`),
      };
    }),
  });
}
