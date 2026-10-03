import type {
  OrderNotificationEventType,
  SupportedLocale,
} from "@fan-support/contracts";

type EventCopy = Readonly<{
  subject: string;
  preheader: string;
  heading: string;
  body: string;
}>;
export type NotificationCopy = Readonly<{
  events: Readonly<Record<OrderNotificationEventType, EventCopy>>;
  orderLabel: string;
  orderedAt: string;
  items: string;
  total: string;
  quantity: string;
  viewOrder: string;
  security: string;
  sourceNote: string;
  moreItems: string;
  /** ADR-019: shown when any line is a VIRTUAL gift, whose delivery is the support record itself. */
  digitalSupport: string;
  digitalItem: string;
}>;

import copy from "./copy.json" with { type: "json" };

/** v2 (ADR-019 digital support copy). Machine-assisted drafts; human review is required before sending outside TEST. */
export const copyV2: Readonly<Record<SupportedLocale, NotificationCopy>> = copy;
