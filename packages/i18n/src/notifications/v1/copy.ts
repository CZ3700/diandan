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
}>;

import copy from "./copy.json" with { type: "json" };

/** Machine-assisted drafts. Human review is required before this version may send outside TEST. */
export const copyV1: Readonly<Record<SupportedLocale, NotificationCopy>> = copy;
