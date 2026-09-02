---
name: fan-support-platform-dev
description: Implement and maintain this repository's fully source-owned global idol gift-support storefront, admin, commerce core, fulfillment, and pluggable payment boundary. Use for any development, testing, architecture, UI, payment, or operations task in this project.
---

# Fan Support Platform Development

## 1. Cross-Conversation Continuity Protocol

Always read `docs/progress/MASTER.md` first. Then read, in order:

1. `docs/FAN_SUPPORT_PLATFORM_SPEC.md`
2. The selected task's ACTIVE file in `docs/progress/` (Phase 1 and Phase 2 may be ACTIVE together only as defined by `MASTER.md`)
3. The selected Task ID in `docs/plan/task-breakdown.md`
4. Its direct dependencies and linked risk IDs in `docs/analysis/risk-assessment.md`

Resume from recorded evidence; do not repeat completed work or infer completion from files alone. Claim exactly one READY task only when its Phase is ACTIVE and its Lane has no executor; record owner and start time, and stop at that task boundary unless explicitly asked to continue.

## S.U.P.E.R Architecture — Mandatory Coding Standard

> Write code like building with LEGO — each brick has a single job, a standard interface, a clear direction, runs anywhere, and can be swapped at will.

All code produced in this project MUST conform to these five principles. Violations are treated as bugs.

### S — Single Purpose
- Each module, file, and function solves exactly one problem
- Prefer decomposition; power comes from composition
- **Litmus test**: Can you describe this module's responsibility in a single sentence? If not, split it.

### U — Unidirectional Flow
- Data flows in one direction: input → processing → output
- Dependencies point inward: outer layers depend on inner, inner layers know nothing about outer
- No circular imports, no reverse dependencies
- **Litmus test**: Can the core logic run unit tests with zero external services?

### P — Ports over Implementation
- Define interface contracts (JSON Schema, types, data structures) BEFORE writing implementation
- All cross-module I/O must be serializable
- Swapping a data source, render layer, or notification channel requires zero changes to core logic
- **Practice**: Every module boundary communicates via explicit, schema-defined contracts

### E — Environment-Agnostic
- Configuration via environment variables or config files, never hardcoded
- All dependencies explicitly declared (requirements.txt / package.json / Cargo.toml)
- Processes are stateless; persistence delegated to external storage
- Logs to stdout. Same codebase runs locally, in Docker, on cloud
- **Config precedence**: Environment variables > .env > config file > in-code defaults

### R — Replaceable Parts
- Any layer can be replaced without affecting others
- Replacement cost is THE core metric of architecture quality
- If replacing one component triggers cascading changes, the architecture is broken
- **Validation**: For each module, ask "Can I swap this with a different implementation by only touching this module's directory?"

## S.U.P.E.R Code Review — Run After Every Task

Before marking any task as complete, verify ALL of the following:

| # | Check | Principle | Pass? |
|:--|:------|:----------|:------|
| 1 | Every new module/file has exactly one responsibility | S | |
| 2 | No function does more than one conceptual thing | S | |
| 3 | Data flows input → processing → output, no reverse deps | U | |
| 4 | No circular imports introduced | U | |
| 5 | Cross-module interfaces are schema-defined (types/contracts) | P | |
| 6 | Module I/O is serializable | P | |
| 7 | No hardcoded paths, URLs, keys, or config values | E | |
| 8 | All new dependencies explicitly declared in dependency file | E | |
| 9 | New modules can be replaced without changes to other modules | R | |
| 10 | All tests pass after the change | — | |

**Scoring**: All pass = ✅ proceed. 1-2 fail = fix before marking complete. 3+ fail = stop and refactor.

## 4. Target Technology Coding Standards

### TypeScript and contracts

- Use strict TypeScript; do not introduce `any` at external boundaries. Parse `unknown` with Zod.
- Cross-module types live in `packages/contracts`; external/provider DTOs stay inside their adapter.
- Every API, event and queue envelope carries `schemaVersion` and a stable error/code vocabulary.
- Store money as integer minor units plus ISO currency; never use floating-point arithmetic for totals.
- Use opaque/branded identifiers where confusing internal UUIDs, public tokens and provider references is possible.
- Define the `SupportedLocale` Zod schema/type/ordered values/default/native names only in `packages/contracts`, exactly as `en | zh-CN | th | vi | ja | es | pt`, with `en` as default/source/final emergency fallback. `packages/i18n`, config, apps and adapters import it rather than copying a locale array. Keep locale, market, country, currency and payment capability as separate schemas; never infer one from another.

### Layers and dependency injection

- Flow is `Browser → Route loader/action → Application use case → Domain → Port → Adapter`.
- `apps/storefront` and `apps/admin` are source-owned clients/BFFs; they do not become an alternate business database or bypass API use cases.
- `domain` imports no React, Next.js, NestJS, ORM or network/provider library.
- `application` owns transaction/Saga orchestration and depends only on domain + ports.
- NestJS modules are composition roots and transport adapters, not the home of business rules.
- PostgreSQL repositories implement persistence ports; application code cannot access ORM/query-builder types.

### Native commerce and content

- PostgreSQL owns idols, content revisions, gifts/variants, eligibility, price books, inventory, carts, orders and fulfillment.
- Content/product/price publication uses immutable revisions and an atomic published pointer; rollback publishes a prior revision without rewriting history.
- Dynamic localized content uses explicit revision translation rows with `(revision, locale)` uniqueness, source-hash stale detection and human approval. Publish/rollback the whole seven-locale revision atomically; do not use a generic JSON translation table or external CMS.
- Inventory uses append-only ledger plus reservations; never update availability without a reasoned, idempotent transaction.
- Re-read canonical catalog, price and inventory rows during add-to-cart and checkout preflight; browser fields are untrusted hints.
- Keep message/display name envelope-encrypted in `support_intent`; public cart/order DTOs expose only the minimum authorized view.
- Binary media belongs in S3-compatible storage, while PostgreSQL owns metadata, references, focal points, alt text, rights and publication state.

### Payments and reliable events

- The project owns checkout orchestration, order amount, routing and state; PCI-sensitive card/wallet input remains inside PSP-hosted pages or hosted fields.
- Accept idempotency keys on payment, refund and state-changing commands.
- Verify webhook from the raw body before parsing; dedupe in inbox before side effects.
- Persist state transition and outbox record in one database transaction; workers must be retry-safe.
- A return URL can query state but cannot set `SUCCEEDED`.
- Treat `UNKNOWN` as reconciliation work; do not automatically charge or switch providers.
- New provider code requires conformance, sandbox, refund, reconciliation, security review and staged deployment. Hot configuration never loads code.

### Frontend and visual quality

- Use tokens from `packages/design-tokens`; no scattered brand colors, spacing, duration or z-index constants.
- SSR critical content; preserve stable layout with declared media aspect ratios.
- Prefer CSS/WAAPI for micro-interactions and one motion library for presence/layout. Animate transform/opacity/clip-path only where practical.
- Every pointer interaction has keyboard/touch parity, visible focus, semantic state and reduced-motion behavior.
- Public HTML routes use `/:locale/...`; language switching preserves the equivalent route/entity, cart, market, currency, amount and payment attempt. Cache/SEO/publication keys include canonical locale.
- Verify changed UI in a real browser at 390×844 and 1440×900; include loading, empty, error, CJK/Thai/Vietnamese/long Spanish-Portuguese copy and pseudo-locale expansion. Phase 3/7 gates cover all seven public locales.

### Tests, errors and observability

- Begin behavior tasks with a failing test. Keep domain tests network-free and deterministic.
- Use shared adapter conformance suites, webhook fixtures and reproducible property-test seeds.
- Translate provider errors once at the adapter boundary. Public errors state impact and recovery without leaking internals.
- Log structured allowlisted fields with request/trace ID. Never log secrets, raw payment payloads, message plaintext, full email, order token or idol address.

## 5. Project-Specific Architecture Context

This is a greenfield modular monolith, not a microservice program. The target repository is defined in specification section 10.2.

Primary violation hotspots to prevent:

- trusting browser idol/product/price data;
- leaking private message or address through APIs, logs, analytics, object metadata or test artifacts;
- letting provider objects/status names escape adapters;
- bypassing canonical price revisions, inventory ledger or reservation locks;
- giant order/payment services that combine mapping, state, side effects and UI DTOs;
- relying on return URLs or non-idempotent webhook processing;
- implementing payment extensibility as runtime code upload;
- hardcoding market, currency, site/primary-domain, idol or provider production exceptions;
- hardcoding locale production exceptions, using English sentences as message keys, coupling locale to market/currency, or caching localized content without locale;
- introducing Shopify/hosted commerce/CMS, Redis, microservices or extra PSPs without a demonstrated need.

Key contracts: `SupportedLocale`, `LocaleContext`, translation/fallback provenance, `CartGiftContext`, `support_intent`, `CheckoutQuote`, `OrderAmountSnapshot`, `InventoryReservation`, `InternalOrderItemSnapshot`, `PublicOrderItemView`, `NotificationCommand`, `ProviderEvent`, `PaymentProvider`, cart/payment/refund/dispute/order/fulfillment state machines and versioned payment route config. Read specification sections 8–14 before changing any of them.

## 6. Progress Update Instructions

When starting a task:

1. Set only that Task ID to `IN_PROGRESS` in its phase file.
2. Add owner, UTC/offset-aware start time, exact scope and intended verification.
3. Keep `MASTER.md` counts synchronized.

Before completion:

1. Run the S.U.P.E.R checklist above.
2. Run affected tests, then repository format/lint/typecheck/build gates.
3. Run task-required browser, integration, security or recovery checks.
4. Record exact commands, exit results, evidence paths and remaining risks.
5. Move to `REVIEW`; only after acceptance move to `DONE`, unlock direct dependents, and update all counts.

Do not write “done” without observable evidence. A local pass is not production release evidence.

## 7. Parallel Execution Protocol

- Read `docs/plan/dependency-graph.md` and `task-breakdown.md` before delegating.
- Treat Phase status as a hard gate; task dependencies never unlock a task inside a LOCKED Phase.
- Run at most one executor per independent lane; assign explicit Task IDs and exclusive file ownership.
- Freeze shared contracts before parallel consumers begin.
- Never let two executors edit the same migration sequence, schemaVersion, global tokens, published content schema or root lockfile concurrently.
- Each executor independently follows S.U.P.E.R and reports tests/evidence.
- The coordinating agent reviews diffs, resolves contract compatibility intentionally, and runs the combined gate after integration.

## 8. Archive Trigger

After P7-06 and all 48 tasks are DONE:

1. Create `docs/archives/fan-support-platform-v1/`.
2. Snapshot the completed analysis, plan, progress and accepted decision records there.
3. Preserve `docs/FAN_SUPPORT_PLATFORM_SPEC.md` and a current `MASTER.md` pointer so future maintenance retains an authoritative entrypoint.
4. Record released versions, deployment identifiers, verification evidence, unresolved accepted risks and rollback runbooks.
5. Start post-MVP work only from a newly versioned specification and task plan.
