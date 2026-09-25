# Persistent TEST notification gateway

This is a local evidence fixture, not a production mail server. It never connects
to SMTP or sends a message to a real recipient. Import
`createPersistentNotificationGatewayHarness({ context })` from
`notification-gateway-harness.mjs`; `context.database` is the owned local
PostgreSQL configuration, and optional `context.own` registers idempotent cleanup.

The return value matches `verifyOrderNotifications`' transport factory:

- `transportKey`, `transport.sendEmail(command)`, `acceptedCount()`, `scope`.
- `dropNextResponse()` drops the actual HTTPS socket after committed acceptance.
- `restart()` stops the receiver process and starts a new PID on the same port;
  it opens a fresh PG pool and retains the exact sender/profile identity.
- `verifyPersistenceAndDeadline()` runs independent protocol cases and returns
  an allowlisted report. It adds its own synthetic acceptance records, so call it
  after application-case counts have been collected if the counts must remain
  separate.
- `inspect()` reads receipt metadata; `close()` stops the process and deletes
  only this harness's randomly named `p406_mail_<uuid>` schema.

The child uses an owned one-day TEST CA with an exact DNS SAN. The parent pins
that CA while connecting to loopback and still requires normal hostname/TLS
verification. Restart creates a new TEST certificate and updates the injected
test fetcher; the production gateway profile and command bytes remain fixed.
The native production adapter uses ordinary `fetch`; there is no insecure TLS
flag or system trust modification.

An advisory transaction lock serializes each idempotency key. The receipt table
contains only the key, request hash, receipt and finite retention deadline. It
never stores recipient, subject, HTML/text body, token, authorization credential
or sender configuration. A matching retained receipt is returned without another
acceptance; a different request hash conflicts. For a new request, one PostgreSQL
clock instant both checks `now < dispatchNotAfter` and records acceptance. A
deadline beyond the profile's finite retention guarantee is also rejected. After
the absolute cutoff, only an existing receipt can be replayed.

The same application command, including its fixed absolute deadline, must be
reused across retries. A real receiver must preserve this protocol and atomically
admit/deduplicate its actual provider operation. The TEST receiver's acceptance
row is its only side effect: this evidence does not claim exactly-once inbox
delivery for ordinary SMTP or an unverified external provider.

Run the dedicated test after the provider package has built:

```sh
FAN_SUPPORT_NOTIFICATION_GATEWAY_REPORT=output/checks/p4-06-notifications/gateway/pg-tls-report.json \
  mise exec node@24.20.0 -- node --test apps/worker/scripts/notification-gateway-harness.test.mjs
```

It creates its own ephemeral PostgreSQL instance and verifies dropped-response
recovery, real process restart, twelve concurrent requests, body drift rejection,
first-send cutoff, old receipt replay and absence of private persisted fields.
It also deletes one owned TEST receipt after the cutoff to simulate finite
retention housekeeping and proves the identical expired command still cannot
create another acceptance. That specific deletion is explicit test injection;
neither database clocks nor business/financial facts are changed.
