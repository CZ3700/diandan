# Publication authorization investigation — bounded result

The unchanged publication HTTP child completed successfully: **exit 0, 51.111674 seconds, 12,826 assertions / 1,462 HTTP requests**. This is one scoped repeat, not a fix for the earlier failures and not a successful single full `pnpm check`.

## Actual process boundary

The launcher executed, from the repository root:

```sh
mise exec node@24.20.0 -- node --import /Users/mario/Desktop/下单/output/checks/p4-04-payment-runtime/publication-auth-diagnostic.mjs /Users/mario/Desktop/下单/apps/api/scripts/publication-runtime-http.mjs
```

The original `runS3IntegrationChild` then spawned:

```sh
/Users/mario/.local/share/mise/installs/node/24.20.0/bin/node /Users/mario/Desktop/下单/apps/api/scripts/publication-runtime-http.mjs --run-publication-runtime-http
```

That child did **not** inherit the parent CLI `--import`. The log contains the parent observer scope announcement but **no `AUTH_QUERY_DIAGNOSTIC` entries**. The planned authorization observer was therefore ineffective for the actual HTTP process. Its two unit tests and scoped lint/format passed, but they do not establish actual query observation.

The parent follows the original S3 infrastructure setup/teardown path and launches the child. Its preload did not modify business PostgreSQL rows, SQL guards, or HTTP returns; business verification runs in the unchanged child without the preload. The optional `PUBLICATION_PURGE_CLOCK_PROBE` was unset. Child success is propagated through the original runner; original worker/API/persistence/S3 cleanup completed before the parent returned.

## Preserved evidence and limits

- `publication-auth-diagnostic-actual.log` and `.json`: 2026-09-08 20:04:51.814314Z → 20:05:42.925779Z, exit 0. The metadata explicitly marks `PARENT_ONLY_NOT_EFFECTIVE_FOR_HTTP`.
- Original HTTP script before/after SHA: `71bedf0a5ea82a50b819b5ab25b5412f92126e1a71949da9ed797a17401b9551`.
- Authorization repository source before/after SHA: `91f528fedc39014092246b0df58e0c5b0a7d249e9cab313ad977a12edd3790e7`.
- Preload before/after SHA: `9fa902d20439e9da951f2e7f6b1c5e187661d40c6f410caaff9a1a800a87bca8`.
- The original package's preceding build step already passed 25/25 tasks on the same frozen implementation. It can be combined with this actual script execution for that package gate; it was not rebuilt here.

The earlier request 16 failure was inside the authorization transaction before publication writes: missing matching publication permission or locale authorization was not distinguished. P4-01's request 16 instead passed authorization and writes before a `PUBLICATION_PERMISSION` COMMIT rejection. The newer request 1300 base-content read can also reject at its Origin boundary; the old publication-manager diagnostic does not trace that separate manager. This successful run provides no query/clock evidence to identify those failures. Earlier wall-clock observations are not a cause established for any of these runs.

No second diagnostic run was started. The parent is completing the other 17 original gates separately; final combined gate coverage remains its independent verification task.
