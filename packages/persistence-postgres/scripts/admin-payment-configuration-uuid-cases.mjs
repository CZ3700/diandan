import { randomUUID } from "node:crypto";
export async function verifyPaymentConfigurationUuid({
  execute,
  published,
  success,
  check,
}) {
  const source = success(
    await execute({ action: "READ", revisionId: published.revisionId }),
    "canonical UUID source",
  );
  const configuration = globalThis.structuredClone(
    source.selected.configuration,
  );
  for (const channel of configuration.channels)
    channel.providerAccountId = channel.providerAccountId.toUpperCase();
  for (const route of configuration.routes)
    route.providerAccountId = route.providerAccountId.toUpperCase();
  const saved = success(
    await execute({
      action: "SAVE",
      sourceRevisionId: published.revisionId.toUpperCase(),
      expectedPublicationId: published.publicationId.toUpperCase(),
      idempotencyKey: randomUUID(),
      configuration,
    }),
    "uppercase UUID save",
  );
  const read = success(
    await execute({
      action: "READ",
      revisionId: saved.revisionId.toUpperCase(),
    }),
    "uppercase UUID read",
  );
  check(
    read.selected.revisionId === saved.revisionId.toLowerCase() &&
      read.selected.configuration.channels.every(
        (c) => c.providerAccountId === c.providerAccountId.toLowerCase(),
      ) &&
      read.selected.configuration.routes.every(
        (r) => r.providerAccountId === r.providerAccountId.toLowerCase(),
      ),
    "new configuration boundary canonicalizes equivalent UUID spellings",
  );
  const validation = success(
    await execute({
      action: "VALIDATE",
      revisionId: saved.revisionId.toUpperCase(),
      expectedPublicationId: published.publicationId.toUpperCase(),
      mode: "PUBLISH",
    }),
    "uppercase UUID validate",
  );
  check(
    validation.valid,
    "canonical identity retains exact copied approval and validation proof",
  );
}
