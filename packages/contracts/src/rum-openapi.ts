import { RUM_ENDPOINT } from "./rum-browser.js";
import { RUM_MAX_BODY_BYTES } from "./rum.js";
export function rumPaths(): Record<string, unknown> {
  return {
    [RUM_ENDPOINT]: {
      post: {
        operationId: "recordAnonymousWebVital",
        summary:
          "Receive one anonymous document metric through the storefront origin",
        description: `Disabled by default. Strict JSON body at most ${RUM_MAX_BODY_BYTES} bytes, including streamed bodies. Origin must equal configured site origin and Sec-Fetch-Site must be same-origin. No cookie authorization, raw URL, visitor/business ID, DOM or performance entries. Server chooses source mode and receipt timestamp; no success is returned when the sink fails. All responses are private, no-store and empty. Browser automation is only self-reported.`,
        security: [],
        parameters: [
          {
            in: "header",
            name: "Origin",
            required: true,
            schema: { type: "string", format: "uri" },
          },
          {
            in: "header",
            name: "Sec-Fetch-Site",
            required: true,
            schema: { const: "same-origin" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RumIntake" },
            },
          },
        },
        responses: Object.fromEntries(
          [
            ["204", "Validated observation accepted by configured sink."],
            ["400", "Invalid body or request."],
            ["403", "Origin check failed."],
            ["404", "Collection disabled."],
            ["405", "POST required."],
            ["413", "Body exceeds admission limit."],
            ["415", "JSON content type required."],
            ["429", "Bounded process admission capacity exceeded."],
            ["503", "Configuration or sink unavailable."],
          ].map(([status, description]) => [
            status,
            {
              description,
              headers: {
                "Cache-Control": { schema: { const: "private, no-store" } },
              },
            },
          ]),
        ),
      },
    },
  };
}
