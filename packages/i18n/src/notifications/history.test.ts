import { readFileSync } from "node:fs";
import {
  orderNotificationRenderCommandSchema,
  type OrderNotificationEventType,
  type SupportedLocale,
} from "@fan-support/contracts";
import { expect, it } from "vitest";
import { createOrderNotificationTemplates } from "./index.js";
import { hashMaterial } from "./v1/identity.js";

/** Deliberately loads stored input and output digests; it never derives its expected result from current copy. */
it.each(["v1", "v2"])(
  "reproduces archived %s outputs by pinned identity across 21 messages and worker time zones",
  (version) => {
    const fixturePath = new URL(
      `./${version}/history.fixture.json`,
      import.meta.url,
    );
    let loaded: unknown;
    try {
      loaded = JSON.parse(readFileSync(fixturePath, "utf8"));
    } catch {
      loaded = undefined;
    }
    expect(
      loaded,
      "independent historical render fixture must exist",
    ).toBeDefined();
    const fixture = loaded as {
      variables: Record<string, unknown>;
      messages: {
        eventType: OrderNotificationEventType;
        locale: SupportedLocale;
        templateKey: string;
        templateVersion: string;
        contentHash: string;
      }[];
    };
    expect(fixture.messages).toHaveLength(21);
    const originalZone = process.env["TZ"];
    try {
      for (const zone of ["UTC", "Asia/Bangkok", "America/Los_Angeles"]) {
        process.env["TZ"] = zone;
        const templates = createOrderNotificationTemplates({
          mode: "TEST_DRAFT",
          incidentFallbackLocales: ["ja"],
        });
        for (const message of fixture.messages) {
          const command = orderNotificationRenderCommandSchema.parse({
            schemaVersion: 1,
            eventType: message.eventType,
            locale: {
              schemaVersion: 1,
              requestedLocale: message.locale,
              resolvedLocale: message.locale,
              fallbackUsed: false,
              templateKey: message.templateKey,
              templateVersion: message.templateVersion,
              contentRevisionIds: [],
            },
            variables: {
              ...fixture.variables,
              orderUrl: `https://store.example/en/order-access#token=${"A".repeat(43)}&order=${String(fixture.variables["publicOrderId"])}`,
            },
          });
          expect(
            hashMaterial(templates.render(command)),
            `${zone}:${message.locale}:${message.eventType}`,
          ).toBe(message.contentHash);
        }
      }
    } finally {
      if (originalZone === undefined) delete process.env["TZ"];
      else process.env["TZ"] = originalZone;
    }
  },
);
