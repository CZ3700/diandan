import {
  createGiftDetailDraftCommandSchema,
  createIdolAliasDraftCommandSchema,
  type ContentAuthoringPlan,
  type ContentAuthoringTarget,
  type ContentAuthoringWriteCommand,
  type ContentAuthoringSnapshot,
} from "@fan-support/contracts";
import {
  prepareGiftDetailDraft,
  prepareIdolAliasDraft,
} from "@fan-support/content";
import { draftRows } from "./content-draft-data.js";
import {
  persistGiftDetailDraft,
  persistIdolAliasDraft,
} from "./content-draft-writes.js";
import {
  AUTHORING_TABLES,
  ownerValue,
  snake,
} from "./content-authoring-model.js";
import type { TransactionClient } from "./transaction-runner.js";
import { contentAuthoringChangedPaths } from "./content-authoring-diff.js";

export async function authoringId(client: TransactionClient): Promise<string> {
  const [row] = await draftRows(client, "SELECT gen_random_uuid() AS id");
  if (typeof row?.["id"] !== "string")
    throw new Error("invalid database identifier");
  return row["id"];
}
async function insert(
  client: TransactionClient,
  table: string,
  values: Readonly<Record<string, unknown>>,
): Promise<void> {
  const entries = Object.entries(values);
  await client.query(
    `INSERT INTO public.${table}(${entries.map(([key]) => key).join(",")}) VALUES(${entries.map((_, i) => `$${i + 1}`).join(",")})`,
    entries.map(([, value]) => value ?? null),
  );
}
const columns = (values: Readonly<Record<string, unknown>>) =>
  Object.fromEntries(
    Object.entries(values).map(([key, value]) => [snake(key), value]),
  );

async function revision(
  client: TransactionClient,
  target: ContentAuthoringTarget,
  plan: ContentAuthoringPlan,
  id: string,
  number: number,
  actorId: string,
  time: string,
): Promise<void> {
  const table = AUTHORING_TABLES[target.kind];
  const values: Record<string, unknown> = {
    id,
    revision: number,
    lifecycle: "DRAFT",
    created_by: actorId,
    created_at: time,
  };
  if (table.ownerColumn !== null)
    values[table.ownerColumn] = ownerValue(target);
  const content = plan.content;
  switch (content.kind) {
    case "IDOL":
      Object.assign(values, columns(content.structure));
      break;
    case "GIFT":
      Object.assign(values, {
        category: content.structure.category,
        delivery_minimum: content.structure.deliveryEstimate.minimum,
        delivery_maximum: content.structure.deliveryEstimate.maximum,
        delivery_unit: content.structure.deliveryEstimate.unit,
        requires_safety_notice: content.structure.requiresSafetyNotice,
        shipping_mode: content.structure.shippingMode,
      });
      break;
    case "POLICY":
      Object.assign(values, columns(content.structure));
      break;
    case "MEDIA_METADATA":
      Object.assign(values, {
        presentation_kind: content.structure.presentationKind,
        focal_x: content.structure.focalPoint.x,
        focal_y: content.structure.focalPoint.y,
      });
      break;
    case "HOMEPAGE":
      break;
  }
  await insert(client, table.revisions, values);
  if (content.kind === "IDOL" || content.kind === "GIFT")
    for (const media of content.media)
      await insert(client, `${content.kind.toLowerCase()}_revision_media`, {
        [table.parent]: id,
        ...columns(media),
      });
  if (content.kind === "GIFT")
    for (const component of content.structure.contents)
      await insert(client, "gift_revision_contents", {
        gift_revision_id: id,
        ...columns(component),
      });
  if (content.kind === "HOMEPAGE")
    for (const slot of content.structure.slots)
      await insert(client, "homepage_slots", {
        homepage_revision_id: id,
        ...columns(slot),
      });
}
async function translatedRows(
  client: TransactionClient,
  target: ContentAuthoringTarget,
  plan: ContentAuthoringPlan,
  revisionId: string,
  auditId: string,
  time: string,
): Promise<void> {
  const table = AUTHORING_TABLES[target.kind];
  for (const text of plan.content.translations) {
    const audit = plan.translationAudits.find(
      (row) => row.locale === text.locale,
    );
    if (!audit) throw new Error("missing prepared translation audit");
    const id = await authoringId(client);
    if (audit.inheritedFrom) {
      const names = [
        "schema_version",
        table.parent,
        "locale",
        "source_hash",
        "translated_from_source_hash",
        "origin",
        "import_batch_id",
        "editor_id",
        "edited_at",
        ...table.fields.map(snake),
      ];
      await client.query(
        `INSERT INTO public.${table.translations}(id,${names.join(",")}) SELECT $1,${names.map((name) => (name === table.parent ? "$2" : name)).join(",")} FROM public.${table.translations} WHERE id=$3`,
        [id, revisionId, audit.inheritedFrom.translationId],
      );
      const namesReview = [
        "schema_version",
        table.translation,
        "sequence",
        "status",
        "submitted_at",
        "reviewer_id",
        "reviewed_at",
        "reviewed_source_hash",
        "reviewed_content_hash",
        "created_at",
      ];
      for (let sequence = 1; sequence <= 3; sequence++)
        await client.query(
          `INSERT INTO public.${table.reviews}(id,${namesReview.join(",")}) SELECT gen_random_uuid(),${namesReview.map((name) => (name === table.translation ? "$1" : name)).join(",")} FROM public.${table.reviews} WHERE ${table.translation}=$2 AND sequence=$3`,
          [id, audit.inheritedFrom.translationId, sequence],
        );
      if (target.kind === "GIFT")
        await client.query(
          "INSERT INTO public.gift_variant_labels(gift_translation_id,gift_variant_id,label) SELECT $1,gift_variant_id,label FROM public.gift_variant_labels WHERE gift_translation_id=$2",
          [id, audit.inheritedFrom.translationId],
        );
      if (target.kind === "HOMEPAGE")
        await client.query(
          "INSERT INTO public.homepage_slot_translations(homepage_translation_id,slot_key,label) SELECT $1,slot_key,label FROM public.homepage_slot_translations WHERE homepage_translation_id=$2",
          [id, audit.inheritedFrom.translationId],
        );
      await insert(client, table.evidence, {
        target_translation_id: id,
        source_translation_id: audit.inheritedFrom.translationId,
        source_approval_review_id: audit.inheritedFrom.reviewId,
        audit_log_id: auditId,
        copied_at: time,
      });
    } else {
      const fields = text.fields as Readonly<Record<string, unknown>>;
      await insert(client, table.translations, {
        id,
        [table.parent]: revisionId,
        locale: audit.locale,
        source_hash: audit.sourceHash,
        translated_from_source_hash: audit.translatedFromSourceHash,
        origin: audit.origin,
        import_batch_id: audit.importBatchId ?? null,
        editor_id: audit.editorId,
        edited_at: audit.editedAt,
        ...Object.fromEntries(
          table.fields.map((name) => [snake(name), fields[name] ?? null]),
        ),
      });
      if (plan.content.kind === "GIFT") {
        const localized = plan.content.translations.find(
          (row) => row.locale === text.locale,
        );
        if (!localized) throw new Error("missing localized gift");
        for (const label of localized.fields.variantLabels)
          await insert(client, "gift_variant_labels", {
            gift_translation_id: id,
            gift_variant_id: label.giftVariantId,
            label: label.label,
          });
      }
      if (plan.content.kind === "HOMEPAGE") {
        const localized = plan.content.translations.find(
          (row) => row.locale === text.locale,
        );
        if (!localized) throw new Error("missing localized homepage");
        for (const label of localized.fields.slotLabels)
          await insert(client, "homepage_slot_translations", {
            homepage_translation_id: id,
            slot_key: label.slotKey,
            label: label.label,
          });
      }
      await insert(client, table.reviews, {
        id: await authoringId(client),
        [table.translation]: id,
        sequence: 1,
        status: "DRAFT",
        created_at: time,
      });
    }
  }
}
async function extensions(
  client: TransactionClient,
  input: ContentAuthoringWriteCommand,
  plan: ContentAuthoringPlan,
  revisionId: string,
  time: string,
  source: ContentAuthoringSnapshot | null,
): Promise<void> {
  const content = plan.content;
  if (content.kind === "IDOL" && content.aliases !== undefined) {
    const command = createIdolAliasDraftCommandSchema.parse({
      schemaVersion: 1,
      id: await authoringId(client),
      idolRevisionId: revisionId,
      aliases: content.aliases,
      actorId: input.actorId,
      reasonCode: input.command.reasonCode,
      requestId: input.requestId,
    });
    const prepared = prepareIdolAliasDraft(command, time);
    if (prepared.outcome !== "SUCCESS")
      throw new Error("invalid prepared aliases");
    await persistIdolAliasDraft(client, command, prepared);
  }
  if (content.kind === "GIFT" && content.details !== undefined) {
    const translations = [];
    for (const text of content.details.translations)
      translations.push({ ...text, id: await authoringId(client) });
    const command = createGiftDetailDraftCommandSchema.parse({
      schemaVersion: 1,
      document: {
        schemaVersion: 1,
        id: await authoringId(client),
        giftRevisionId: revisionId,
        blocks: content.details.blocks,
      },
      translations,
      actorId: input.actorId,
      reasonCode: input.command.reasonCode,
      requestId: input.requestId,
    });
    let prepared = prepareGiftDetailDraft(command, time);
    if (prepared.outcome !== "SUCCESS")
      throw new Error("invalid prepared details");
    if (
      input.command.action === "COPY" &&
      input.command.changes.kind === "GIFT" &&
      input.command.changes.details === undefined &&
      source?.extensions.details
    ) {
      // A copied document retains the exact source lineage. Migration 0013 and
      // its canonical loader still reject stale detail packages; this does not
      // introduce a new way to persist or silently refresh stale translations.
      const original = source.extensions.details;
      prepared = {
        ...prepared,
        translations: prepared.translations.map((row) => {
          const old = original.translations.find(
            (candidate) => candidate.locale === row.locale,
          );
          if (!old) throw new Error("missing copied detail lineage");
          return {
            ...row,
            translatedFromSourceHash: old.translatedFromSourceHash,
          };
        }),
      };
    }
    await persistGiftDetailDraft(client, command, prepared, time);
  }
}
export async function persistContentAuthoring(
  client: TransactionClient,
  input: ContentAuthoringWriteCommand,
  plan: ContentAuthoringPlan,
  time: string,
  source: ContentAuthoringSnapshot | null,
): Promise<string> {
  const { command } = input,
    table = AUTHORING_TABLES[command.target.kind],
    id = await authoringId(client),
    auditId = await authoringId(client);
  // The audit FK is deferred so the receipt and audit can be written after the
  // complete payload. Any failure rolls back both the content and its evidence.
  await client.query("SET CONSTRAINTS ALL DEFERRED");
  await revision(
    client,
    command.target,
    plan,
    id,
    command.expectedVersion + 1,
    input.actorId,
    time,
  );
  await translatedRows(client, command.target, plan, id, auditId, time);
  await extensions(client, input, plan, id, time, source);
  if (command.target.kind === "IDOL" || command.target.kind === "GIFT")
    await client.query(
      `UPDATE public.${table.ownerTable} SET draft_revision_id=$1,version=version+1,updated_at=$2 WHERE id=$3`,
      [id, time, ownerValue(command.target)],
    );
  await insert(client, "audit_logs", {
    id: auditId,
    actor_type: "ADMIN",
    actor_id: input.actorId,
    action: `CONTENT_REVISION_${command.action}`,
    subject_type: "CONTENT_REVISION",
    subject_id: id,
    reason_code: command.reasonCode,
    request_id: input.requestId,
    correlation_id: input.requestId,
    outcome: "SUCCEEDED",
    created_at: time,
  });
  await insert(client, "content_authoring_receipts", {
    changed_paths: contentAuthoringChangedPaths(plan, source),
    [table.parent]: id,
    [`source_${table.parent}`]:
      command.action === "COPY" ? command.sourceRevisionId : null,
    action: command.action,
    expected_version: command.expectedVersion,
    source_snapshot_hash:
      command.action === "COPY" ? command.expectedSourceHash : null,
    actor_id: input.actorId,
    audit_log_id: auditId,
    created_at: time,
  });
  return id;
}
