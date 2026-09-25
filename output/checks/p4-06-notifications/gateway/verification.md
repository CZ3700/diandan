# P4-06 notification gateway scoped verification

The HTTPS sender validates strict profile-bound receipts and now rejects
`acceptedAt >= dispatchNotAfter`. A valid earlier receipt remains replayable after
the cutoff. The absolute deadline is part of the immutable request hash. Node
types are declared, and the TLS test harness is excluded from production build.

Evidence in this directory:

- `deadline-red.log`: two new deadline boundary assertions failed before the fix.
- `types-red.log`: the original Node build typing failures.
- `tests.log`: 3 provider files / 26 tests passed, including real TLS cases.
- `types.log`, `build.log`, `lint.log`, `format-check.log`: exit 0.
- `pg-tls-red.log`: the new persistent receiver test failed before implementation.
- `pg-tls-green.log` and `pg-tls-report.json`: actual PostgreSQL and HTTPS passed
  with one acceptance after a dropped socket response; a new child PID returned
  the original receipt; twelve concurrent requests produced one acceptance;
  changed bytes conflicted; no first send was admitted after the actual PG clock
  reached the fixed deadline; an earlier receipt still replayed.
- Persistence was checked for absence of recipient, message content, raw token
  and private fields. Child diagnostic streams produced no output. Only key,
  request hash, receipt and finite retention timestamp are retained.

The child restart is a graceful process stop followed by a real new process.
The finite-retention cleanup case deletes only an owned TEST receipt after the
deadline to simulate housekeeping; the suite does not wait an hour or alter
database clocks or financial facts. Acceptance rows are the only TEST side
effect. No SMTP connection or real recipient delivery is attempted, and these
results do not establish exactly-once delivery for an external mail provider.

Integration entry point and receiver protocol are documented in
`apps/worker/scripts/notification-gateway-harness.md`. The parent owns actual
Worker/application integration, immutable profile retention configuration and
final release acceptance.

The separately added `notification-link-browser.mjs` consumes a transient actual
Worker email command, starts the existing production Next/order-access stack,
and writes only a safe report plus authorized anonymous order screenshots.
`link-browser-red.log` and `link-browser-valid-red.log` precede its two passing
preflight checks in `link-browser-green.log`. Its real browser result belongs to
the subsequent integrated run; preflight tests alone do not prove the CTA works.

S.U.P.E.R review: sender, TLS harness, persistent receiver, browser verifier and
test each have a defined purpose; dependencies point to contracts/ports; wire
payloads are schema-defined and serializable; production profile configuration
is injected; Node types are declared; adapters remain replaceable. Scoped
provider checks pass. Combined repository/Worker/browser gates remain with the
parent and must pass before P4-06 completion.
