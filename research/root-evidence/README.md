# Root research evidence

These files are point-in-time captures of publicly reachable reference sites. They are research evidence only and are not application fixtures or production dependencies.

Before the repository baseline was created, volatile credential-shaped values were removed from the captures:

- JWT and access-token values;
- `Authorization` header values;
- `Set-Cookie` response values.

Redactions use the literal marker `[REDACTED_SECRET]` while retaining field names, cookie names, response metadata, and surrounding page structure. Never replace these markers with live values or commit authenticated browser/session captures.
