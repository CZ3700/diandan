import { expect, test, vi } from "vitest";
import { notificationEmailDispatchSchema } from "@fan-support/contracts";
import * as adapter from "./index.js";

const id = "12345678-1234-4234-8234-123456789012";
const profile = {
  schemaVersion: 1,
  protocol: "zeptomail-v1",
  environment: "TEST",
  apiOrigin: "https://mail.example.test",
  fromEmail: "orders@example.test",
  fromName: "Studio",
  replyToEmail: "support@example.test",
  timeoutMs: 200,
  idempotencyRetentionSeconds: 3600,
};
const command = () =>
  notificationEmailDispatchSchema.parse({
    schemaVersion: 1,
    operation: "SEND_NOTIFICATION",
    channel: "EMAIL",
    dispatchNotAfter: new Date(Date.now() + 60000).toISOString(),
    recipient: "synthetic-fan@example.test",
    notification: {
      schemaVersion: 1,
      id,
      orderId: id,
      customerContactId: id,
      eventType: "PAYMENT_CONFIRMED",
      locale: {
        schemaVersion: 1,
        requestedLocale: "zh-CN",
        resolvedLocale: "zh-CN",
        fallbackUsed: false,
        templateKey: "order.payment.confirmed",
        templateVersion: "v1.1",
        contentRevisionIds: [],
      },
      idempotencyKey: `notification:${id}`,
      correlationId: id,
    },
    content: {
      subject: "订单已付款",
      preheader: "安全查询",
      text: "https://store.example.test/zh-CN/order-access#token=synthetic-test-token",
      html: '<a href="https://store.example.test/zh-CN/order-access#token=synthetic-test-token">查询</a>',
    },
  });
const accepted = {
  data: [
    { code: "EM_104", additional_info: [], message: "Email request received" },
  ],
  message: "OK",
  request_id: "fixture-request-123",
};
function factory() {
  const candidate = (
    adapter as unknown as {
      createZeptoMailSubmission?: (options: {
        profile: unknown;
        resolveCredential(): Promise<string>;
        fetcher?: typeof fetch;
      }) => {
        transportKey: string;
        submitter: { sendEmail(command: unknown): Promise<unknown> };
      };
    }
  ).createZeptoMailSubmission;
  expect(candidate).toBeDefined();
  return candidate!;
}
const response = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
function instance(fetcher: typeof fetch, overrides = {}) {
  return factory()({
    profile: { ...profile, ...overrides },
    resolveCredential: async () => "synthetic-send-token-123456",
    fetcher,
  });
}

test("submits the native one-recipient request with tracking disabled and no internal credential metadata", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => response(accepted));
  const client = instance(fetcher);
  const email = command();
  expect(await client.submitter.sendEmail(email)).toMatchObject({
    outcome: "SUCCESS",
    value: {
      status: "ACCEPTED",
      providerReference: "zeptomail/fixture-request-123",
    },
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0]!;
  expect(String(url)).toBe("https://mail.example.test/v1.1/email");
  expect(init).toMatchObject({
    method: "POST",
    redirect: "error",
    credentials: "omit",
    cache: "no-store",
    headers: { authorization: "Zoho-enczapikey synthetic-send-token-123456" },
  });
  expect(JSON.parse(String(init?.body))).toEqual({
    from: { address: profile.fromEmail, name: profile.fromName },
    to: [{ email_address: { address: email.recipient } }],
    reply_to: [{ address: profile.replyToEmail }],
    subject: email.content.subject,
    textbody: email.content.text,
    htmlbody: email.content.html,
    client_reference: id,
    track_clicks: false,
    track_opens: false,
  });
  expect(new Headers(init?.headers).has("idempotency-key")).toBe(false);
  expect(client.transportKey).toMatch(/^[a-f0-9]{64}$/u);
});

test("is explicitly a single submission, without claiming provider deduplication", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => response(accepted));
  const client = instance(fetcher);
  await client.submitter.sendEmail(command());
  await client.submitter.sendEmail(command());
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(client).not.toHaveProperty("transport");
});

test("includes the explicit verified bounce address when an account requires it", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => response(accepted));
  const client = instance(fetcher, { bounceEmail: "bounces@example.test" });
  await client.submitter.sendEmail(command());
  expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toHaveProperty(
    "bounce_address",
    "bounces@example.test",
  );
  expect(client.transportKey).not.toBe(
    instance(async () => response(accepted)).transportKey,
  );
});

test("accepts the separately documented ZeptoMail legacy email receipt", async () => {
  const body = {
    ...accepted,
    object: "email",
    data: [{ code: "EM_101", message: "Email queued" }],
  };
  expect(
    await instance(async () => response(body)).submitter.sendEmail(command()),
  ).toMatchObject({ outcome: "SUCCESS", value: { status: "ACCEPTED" } });
});

test("legacy response codes and contradictory response bodies do not imply acceptance", async () => {
  for (const body of [
    { ...accepted, data: [{ code: "EM_101" }] },
    { ...accepted, object: "sms", data: [{ code: "EM_101" }] },
    { ...accepted, error: { code: "TM_4001" } },
  ]) {
    expect(
      await instance(async () => response(body)).submitter.sendEmail(command()),
    ).toMatchObject({
      outcome: "FAILURE",
      error: { code: "MALFORMED_PROVIDER_RESPONSE" },
    });
  }
});

test("normalizes the documented legacy rejection without retaining private detail fields", async () => {
  const body = {
    error: {
      code: "TM_4001",
      details: [
        {
          code: "SM_113",
          message: "synthetic-private",
          target: "bounce_address",
        },
      ],
      message: "Access Denied",
      request_id: "legacy-error-123",
    },
  };
  expect(
    await instance(async () => response(body, 400)).submitter.sendEmail(
      command(),
    ),
  ).toEqual({
    schemaVersion: 1,
    operation: "SEND_NOTIFICATION",
    outcome: "FAILURE",
    error: { schemaVersion: 1, code: "CONFIGURATION_ERROR", recovery: "NONE" },
  });
});

test.each([
  [401, {}, "AUTHENTICATION_FAILED"],
  [403, {}, "AUTHENTICATION_FAILED"],
  [429, {}, "RATE_LIMITED"],
  [
    400,
    {
      data: { error_code: "TM_3201", message: "private provider text" },
      message: "error",
    },
    "TEMPLATE_CONTENT_INVALID",
  ],
  [
    400,
    {
      data: { error_code: "TM_4001", message: "private provider text" },
      message: "error",
    },
    "CONFIGURATION_ERROR",
  ],
  [
    400,
    { data: { error_code: "UNRECOGNIZED" } },
    "MALFORMED_PROVIDER_RESPONSE",
  ],
  [500, {}, "TIMEOUT_OUTCOME_UNKNOWN"],
  [503, accepted, "TIMEOUT_OUTCOME_UNKNOWN"],
  [307, {}, "TIMEOUT_OUTCOME_UNKNOWN"],
  [404, {}, "TIMEOUT_OUTCOME_UNKNOWN"],
] as const)(
  "classifies HTTP %s without exposing provider text",
  async (status, body, code) => {
    const fetcher = vi.fn<typeof fetch>(async () => response(body, status));
    const result = await instance(fetcher).submitter.sendEmail(command());
    expect(result).toMatchObject({ outcome: "FAILURE", error: { code } });
    expect(JSON.stringify(result)).not.toMatch(
      /private provider text|synthetic-fan|synthetic-test-token/u,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);

test.each([
  {},
  { ...accepted, request_id: "" },
  { ...accepted, request_id: "unsafe@address.test" },
  { ...accepted, data: [] },
  { ...accepted, data: [{ code: "EM_104" }, { code: "EM_104" }] },
  { ...accepted, data: [{ code: "EM_999" }] },
])("never accepts an incomplete success receipt %j", async (body) => {
  expect(
    await instance(async () => response(body)).submitter.sendEmail(command()),
  ).toMatchObject({
    outcome: "FAILURE",
    error: { code: "MALFORMED_PROVIDER_RESPONSE" },
  });
});

test("does not dispatch invalid commands, expired admission, long subjects or invalid credentials", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => response(accepted));
  const client = instance(fetcher);
  expect(await client.submitter.sendEmail({})).toMatchObject({
    error: { code: "INVALID_COMMAND" },
  });
  expect(
    await client.submitter.sendEmail({
      ...command(),
      dispatchNotAfter: new Date(Date.now() - 1000).toISOString(),
    }),
  ).toMatchObject({ error: { code: "CONFIGURATION_ERROR" } });
  expect(
    await client.submitter.sendEmail({
      ...command(),
      content: { ...command().content, subject: "s".repeat(501) },
    }),
  ).toMatchObject({ error: { code: "TEMPLATE_CONTENT_INVALID" } });
  const invalid = factory()({
    profile,
    resolveCredential: async () => "invalid\r\ntoken",
    fetcher,
  });
  expect(await invalid.submitter.sendEmail(command())).toMatchObject({
    error: { code: "CONFIGURATION_ERROR" },
  });
  expect(fetcher).not.toHaveBeenCalled();
});

test("total deadline includes credential resolution and preserves no-dispatch certainty", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => response(accepted));
  const client = factory()({
    profile: { ...profile, timeoutMs: 100 },
    resolveCredential: () => new Promise(() => undefined),
    fetcher,
  });
  expect(await client.submitter.sendEmail(command())).toMatchObject({
    error: { code: "TEMPORARY_UNAVAILABLE" },
  });
  expect(fetcher).not.toHaveBeenCalled();
});

test("rechecks the admission cutoff after credential resolution", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => response(accepted));
  const email = {
    ...command(),
    dispatchNotAfter: new Date(Date.now() + 20).toISOString(),
  };
  const client = factory()({
    profile,
    resolveCredential: async () => {
      await new Promise((r) => setTimeout(r, 40));
      return "synthetic-send-token-123456";
    },
    fetcher,
  });
  expect(await client.submitter.sendEmail(email)).toMatchObject({
    error: { code: "CONFIGURATION_ERROR" },
  });
  expect(fetcher).not.toHaveBeenCalled();
});

test("retains a definite acceptance received after local admission cutoff", async () => {
  const email = {
    ...command(),
    dispatchNotAfter: new Date(Date.now() + 20).toISOString(),
  };
  const fetcher = vi.fn<typeof fetch>(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
    return response(accepted);
  });
  const result = await instance(fetcher).submitter.sendEmail(email);
  expect(result).toMatchObject({
    outcome: "SUCCESS",
    value: { status: "ACCEPTED" },
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("LIVE production submission uses the ordinary fetch path with the same bounded protocol", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => response(accepted));
  vi.stubGlobal("fetch", fetcher);
  try {
    const client = factory()({
      profile: { ...profile, environment: "LIVE" },
      resolveCredential: async () => "synthetic-send-token-123456",
    });
    expect(await client.submitter.sendEmail(command())).toMatchObject({
      outcome: "SUCCESS",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("bounds rate-limit delay and excludes credentials from stable profile identity", async () => {
  const first = instance(async () =>
    response({}, 429, { "retry-after": "99999999" }),
  );
  expect(await first.submitter.sendEmail(command())).toMatchObject({
    error: {
      code: "RATE_LIMITED",
      recovery: "RETRY_SAME_COMMAND",
      retryAfterMs: 86400000,
    },
  });
  const second = factory()({
    profile,
    resolveCredential: async () => "different-secret-material",
    fetcher: async () => response(accepted),
  });
  expect(second.transportKey).toBe(first.transportKey);
  expect(
    instance(async () => response(accepted), { fromName: "Changed Studio" })
      .transportKey,
  ).not.toBe(first.transportKey);
  expect(() =>
    instance(async () => response(accepted), {
      apiOrigin: "http://unsafe.example.test",
    }),
  ).toThrow("Invalid ZeptoMail configuration");
  expect(() =>
    factory()({
      profile,
      resolveCredential: async () => "synthetic-send-token-123456",
    }),
  ).toThrow("Invalid ZeptoMail configuration");
});
