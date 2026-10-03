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

/** v3 (2026-10-03 copy review): v2 variables and layout with revised fan-facing copy in all seven locales. */
export const copyV3: Readonly<Record<SupportedLocale, NotificationCopy>> = copy;
