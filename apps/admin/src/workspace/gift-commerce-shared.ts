import type {
  GiftCommerceContextResponse,
  GiftCommerceGift,
  SupportedLocale,
} from "@fan-support/contracts";
import type { AdminClient } from "./client";
import type { Translate } from "./components";
export type CommercePanelProps = {
  client: AdminClient;
  context: GiftCommerceContextResponse;
  gift: GiftCommerceGift;
  locale: SupportedLocale;
  t: Translate;
  reason: string;
  busy: boolean;
  run: (work: () => Promise<void>, message?: string) => void;
  refresh: () => void;
  onDirty: (value: boolean) => void;
};
export const policyLabels = {
  TRACKED: "policyTracked",
  PROCURE_ON_DEMAND: "policyOnDemand",
  PREORDER: "policyPreorder",
} as const;
export const policyHints = {
  TRACKED: "trackedHint",
  PROCURE_ON_DEMAND: "onDemandHint",
  PREORDER: "preorderHint",
} as const;
