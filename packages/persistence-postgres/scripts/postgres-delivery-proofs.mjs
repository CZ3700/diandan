#!/usr/bin/env node
/**
 * F1-4 delivery proofs on real PostgreSQL: repository flows, the fan projection, storage guards and
 * rollback refusal. Bare historical rows are seeded in replica mode; every proof write goes through
 * the production repositories so migration 0040's deferred authority checks run at COMMIT.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { Client } from "pg";
import { deliveryProofRenditionObjectKey } from "@fan-support/contracts";
import {
  createPostgresPersistence,
  runMigrations,
  withEphemeralPostgres,
} from "../dist/index.js";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const hex = () => randomBytes(32).toString("hex");
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
let assertions = 0;
function check(condition, label) {
  assertions++;
  assert.ok(condition, label);
}
const errorCode = (error) =>
  typeof error?.code === "string" ? error.code : "unknown";

async function seedActors(client) {
  for (const key of ["orders.read", "orders.fulfillment", "orders.manage"])
    await client.query(
      "INSERT INTO permissions(id,permission_key,description) VALUES($1,$2,'Delivery proof acceptance') ON CONFLICT(permission_key) DO NOTHING",
      [randomUUID(), key],
    );
  const definitions = {
    operator: ["orders.read", "orders.fulfillment"],
    manager: ["orders.read", "orders.fulfillment", "orders.manage"],
    reader: ["orders.read"],
  };
  const actors = {};
  for (const [name, grants] of Object.entries(definitions)) {
    const id = randomUUID(),
      role = randomUUID(),
      sessionId = randomUUID(),
      token = hex(),
      csrf = hex();
    await client.query(
      "INSERT INTO admin_identities(id,issuer,external_subject_hash,status) VALUES($1,'https://proof-identity.example.test',$2,'ACTIVE')",
      [id, randomBytes(32)],
    );
    await client.query(
      "INSERT INTO roles(id,role_key,description) VALUES($1,$2,'Delivery proof acceptance role')",
      [role, `proofs:${name}:${id}`],
    );
    await client.query(
      "INSERT INTO admin_identity_roles(admin_identity_id,role_id) VALUES($1,$2)",
      [id, role],
    );
    await client.query(
      "INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE permission_key=ANY($2::text[])",
      [role, grants],
    );
    await client.query(
      "INSERT INTO admin_sessions(id,admin_identity_id,session_token_digest,csrf_token_digest,authenticated_with_mfa,expires_at) VALUES($1,$2,decode($3,'hex'),decode($4,'hex'),true,clock_timestamp()+interval '1 hour')",
      [sessionId, id, token, csrf],
    );
    actors[name] = {
      id,
      sessionId,
      access: () => ({
        schemaVersion: 1,
        sessionTokenDigest: token,
        csrfTokenDigest: csrf,
        requestId: randomUUID(),
        correlationId: randomUUID(),
      }),
    };
  }
  return actors;
}

/** Bare purchase history: two delivered-capable physical lines, one digital line, one pending line. */
async function seedOrder(client, createdBy) {
  const order = randomUUID(),
    cart = randomUUID(),
    publicOrderId = randomUUID(),
    portrait = randomUUID(),
    giftImage = randomUUID(),
    sessionDigest = hex();
  const lines = [
    ["A", "PHYSICAL", "PREPARING"],
    ["B", "PHYSICAL", "DELIVERED"],
    ["V", "VIRTUAL", "DELIVERED"],
    ["P", "PHYSICAL", "PENDING"],
  ].map(([key, kind, status]) => ({
    key,
    kind,
    status,
    item: randomUUID(),
    cartItem: randomUUID(),
    intent: randomUUID(),
    idol: randomUUID(),
    profile: randomUUID(),
    fulfillment: randomUUID(),
  }));
  await client.query("BEGIN");
  await client.query("SET LOCAL session_replication_role = replica");
  await client.query(
    `INSERT INTO media_assets(id,checksum_sha256,mime_type,width,height,byte_size,object_key,processing_status,rights_status,rights_reference) VALUES
     ($1,repeat('a',64),'image/webp',800,1000,1000,'proof-fixture/portrait.webp','READY','APPROVED','fixture'),
     ($2,repeat('b',64),'image/webp',800,800,1000,'proof-fixture/gift.webp','READY','APPROVED','fixture')`,
    [portrait, giftImage],
  );
  await client.query(
    `INSERT INTO media_variants(id,media_asset_id,format,width,height,byte_size,checksum_sha256,object_key,status) VALUES
     ($1,$2,'WEBP',800,1000,1000,repeat('c',64),'processed/v1/proof-fixture/portrait.webp','READY'),
     ($3,$4,'WEBP',800,800,1000,repeat('d',64),'processed/v1/proof-fixture/gift.webp','READY')`,
    [randomUUID(), portrait, randomUUID(), giftImage],
  );
  await client.query(
    `INSERT INTO carts(id,token_digest,token_pepper_version,presentation_locale,market,currency,status,version,expires_at,locked_order_id)
     VALUES($1,decode(repeat('ab',32),'hex'),'fixture-v1','en','US','USD','CONVERTED',1,transaction_timestamp()+interval '1 hour',$2)`,
    [cart, order],
  );
  await client.query(
    `INSERT INTO orders(id,public_order_id,checkout_session_id,checkout_quote_id,cart_id,customer_contact_id,presentation_locale,market,currency,quote_revision,quote_expires_at,subtotal_minor,total_amount_minor,order_status,payment_status,dispute_status,fulfillment_status,current_payment_attempt_id,version)
     VALUES($1,$2,$3,$4,$5,$6,'en','US','USD',1,transaction_timestamp()+interval '1 hour',4000,4000,'OPEN','PAID','NONE','PREPARING',$7,5)`,
    [
      order,
      publicOrderId,
      randomUUID(),
      randomUUID(),
      cart,
      randomUUID(),
      randomUUID(),
    ],
  );
  for (const [index, line] of lines.entries()) {
    await client.query(
      `INSERT INTO cart_items(id,cart_id,gift_variant_id,observed_price_id,quantity,display_mode,has_fan_message,request_id,correlation_id)
       VALUES($1,$2,$3,$4,1,'anonymous',false,$5,$5)`,
      [line.cartItem, cart, randomUUID(), randomUUID(), randomUUID()],
    );
    await client.query(
      `INSERT INTO support_intents(id,cart_item_id,idol_id,display_mode,encrypted_data_key,encryption_key_version,privacy_state,moderation_status,created_presentation_locale,fan_message_locale,status,expires_at)
       VALUES($1,$2,$3,'anonymous',decode(repeat('ab',16),'hex'),'fixture-v1','ACTIVE','PENDING','en','und','CONVERTED',transaction_timestamp()+interval '1 hour')`,
      [line.intent, line.cartItem, line.idol],
    );
    await client.query(
      `INSERT INTO order_items(id,order_id,cart_item_id,support_intent_id,idol_id,idol_handle,idol_display_name,idol_translation_revision_id,
        idol_translation_requested_locale,idol_translation_resolved_locale,idol_translation_fallback_used,idol_portrait_asset_id,
        idol_portrait_checksum_sha256,idol_portrait_object_key,idol_portrait_metadata_revision_id,idol_portrait_alt,
        idol_portrait_alt_translation_revision_id,idol_portrait_alt_requested_locale,idol_portrait_alt_resolved_locale,
        idol_portrait_alt_fallback_used,gift_id,gift_variant_id,gift_title,gift_translation_revision_id,gift_translation_requested_locale,
        gift_translation_resolved_locale,gift_translation_fallback_used,gift_image_asset_id,gift_image_checksum_sha256,gift_image_object_key,
        gift_image_metadata_revision_id,gift_image_alt,gift_image_alt_translation_revision_id,gift_image_alt_requested_locale,
        gift_image_alt_resolved_locale,gift_image_alt_fallback_used,price_id,price_revision,quantity,unit_amount_minor,line_subtotal_minor,
        tax_amount_minor,discount_amount_minor,line_total_minor,currency,display_mode,gift_kind,created_at)
       VALUES($1,$2,$3,$4,$5,$6,'Proof Idol',$7,'en','en',false,$8,repeat('a',64),'proof-fixture/portrait.webp',$9,'Proof idol portrait',$10,'en','en',false,
        $11,$12,'Proof Gift',$13,'en','en',false,$14,repeat('b',64),'proof-fixture/gift.webp',$15,'Proof gift image',$16,'en','en',false,
        $17,1,1,1000,1000,0,0,1000,'USD','anonymous',$18,transaction_timestamp()+$19::int*interval '1 millisecond')`,
      [
        line.item,
        order,
        line.cartItem,
        line.intent,
        line.idol,
        `proof-idol-${index + 1}`,
        randomUUID(),
        portrait,
        randomUUID(),
        randomUUID(),
        randomUUID(),
        randomUUID(),
        randomUUID(),
        giftImage,
        randomUUID(),
        randomUUID(),
        randomUUID(),
        line.kind,
        index,
      ],
    );
    await client.query(
      `INSERT INTO idol_fulfillment_profiles(id,idol_id,profile_version,status,profile_ciphertext,encrypted_data_key,encryption_key_version,created_by)
       VALUES($1,$2,1,'ACTIVE',decode(repeat('ab',16),'hex'),decode(repeat('cd',16),'hex'),'fixture-v1',$3)`,
      [line.profile, line.idol, createdBy],
    );
    await client.query(
      `INSERT INTO fulfillments(id,order_id,order_item_id,idol_id,fulfillment_profile_id,status,prepared_at,delivered_at)
       VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $6::text IN ('PREPARING','DELIVERED') THEN transaction_timestamp() END,CASE WHEN $6::text='DELIVERED' THEN transaction_timestamp() END)`,
      [
        line.fulfillment,
        order,
        line.item,
        line.idol,
        line.profile,
        line.status,
      ],
    );
  }
  await client.query(
    `INSERT INTO order_access_sessions(id,order_id,public_order_id,exchanged_token_id,session_token_digest,token_pepper_version,status,expires_at)
     VALUES($1,$2,$3,$4,decode($5,'hex'),'v1','ACTIVE',transaction_timestamp()+interval '1 hour')`,
    [randomUUID(), order, publicOrderId, randomUUID(), sessionDigest],
  );
  await client.query("COMMIT");
  return {
    order,
    publicOrderId,
    sessionDigest,
    lines: Object.fromEntries(lines.map((line) => [line.key, line])),
  };
}

function rendition(uploadId, fill, width, height) {
  return {
    objectKey: deliveryProofRenditionObjectKey(uploadId, fill.repeat(64)),
    checksumSha256: fill.repeat(64),
    byteSize: 2048,
    width,
    height,
    mimeType: "image/webp",
  };
}

async function main() {
  await withEphemeralPostgres(async (clientConfig) => {
    // The fan read projection uses current repository code and therefore needs the current schema.
    const migrated = await runMigrations({
      clientConfig,
      workspaceRoot,
      command: { direction: "up" },
    });
    const client = new Client(clientConfig);
    await client.connect();
    const persistence = createPostgresPersistence(clientConfig, {
      catalogPublicMediaBaseUrl: "https://media.example.test",
    });
    try {
      const actors = await seedActors(client);
      const fixture = await seedOrder(client, actors.manager.id);
      const { lines } = fixture;
      const admin = (work) =>
        persistence.adminOrdersTransactionManager.runInAdminOrdersTransaction(
          work,
        );
      const request = (actor, command) => ({
        schemaVersion: 1,
        access: actor.access(),
        command: { schemaVersion: 1, ...command },
        requestHash: "idempotencyKey" in command ? hash(command) : null,
      });
      const lineCommand = (line, extra = {}) => ({
        orderId: fixture.order,
        expectedOrderVersion: 5,
        idempotencyKey: `proof-${randomUUID()}`,
        reasonCode: "DELIVERY_PROOF_UPLOAD",
        fulfillmentId: line.fulfillment,
        expectedFulfillmentVersion: 1,
        ...extra,
      });
      const begin = (actor, line, extra = {}) =>
        lineCommand(line, {
          action: "BEGIN_PROOF_UPLOAD",
          checksumSha256: hex(),
          byteSize: 4096,
          mimeType: "image/jpeg",
          ...extra,
        });
      const reserve = (actor, command) =>
        admin(({ adminOrders }) =>
          adminOrders.reserveProofUpload(request(actor, command)),
        );
      const execute = (actor, command) =>
        admin(({ adminOrders }) =>
          adminOrders.execute(request(actor, command)),
        );
      const ready = async (actor, line) => {
        const reservation = await reserve(actor, begin(actor, line));
        check(
          reservation.kind === "PROOF_RESERVATION",
          `reservation for line ${line.key}`,
        );
        const done = await admin(({ adminOrders }) =>
          adminOrders.completeProofUpload({
            schemaVersion: 1,
            access: actor.access(),
            orderId: fixture.order,
            uploadId: reservation.uploadId,
            source: reservation.source,
            result: {
              schemaVersion: 1,
              outcome: "SUCCESS",
              profileVersion: 1,
              uploadId: reservation.uploadId,
              metadataPolicy: "STRIP_ALL_SRGB",
              display: rendition(reservation.uploadId, "e", 1600, 1200),
              thumbnail: rendition(reservation.uploadId, "f", 480, 360),
            },
          }),
        );
        check(done.kind === "PROOF_UPLOAD", "reserved upload completes");
        return reservation.uploadId;
      };
      const candidates = (digest = fixture.sessionDigest) => [
        { schemaVersion: 1, tokenDigest: digest, pepperVersion: "v1" },
      ];
      const fanRead = () =>
        persistence.orderAccessTransactionManager.runInOrderAccessTransaction(
          (repository) =>
            repository.read({
              schemaVersion: 1,
              publicOrderId: fixture.publicOrderId,
              sessionCandidates: candidates(),
            }),
        );
      const locate = (proofId, rendition = "thumbnail", digest) =>
        persistence.orderAccessTransactionManager
          .runInOrderAccessTransaction((repository) =>
            repository.locateProof({
              schemaVersion: 1,
              publicOrderId: fixture.publicOrderId,
              proofId,
              rendition,
              sessionCandidates: candidates(digest),
            }),
          )
          .then(
            (value) => value,
            (error) => ({ denied: error?.code }),
          );
      const itemFor = (detail, line) =>
        detail.items[["A", "B", "V", "P"].indexOf(line.key)];
      const sql = async (query, values = []) =>
        (await client.query(query, values)).rows;

      // 1. Only physical lines being prepared or delivered accept uploads, by delivery staff.
      for (const [actor, line, code] of [
        [actors.operator, lines.P, "TRANSITION_NOT_ALLOWED"],
        [actors.operator, lines.V, "TRANSITION_NOT_ALLOWED"],
        [actors.reader, lines.A, "FORBIDDEN"],
      ])
        check(
          (await reserve(actor, begin(actor, line))).code === code,
          `line ${line.key} reservation rejected with ${code}`,
        );

      // 2. A reservation is audited, receipted and replayable only for the same request.
      const first = begin(actors.operator, lines.A);
      const reservation = await reserve(actors.operator, first);
      check(
        reservation.kind === "PROOF_RESERVATION" &&
          reservation.replayed === false &&
          reservation.source.objectKey ===
            `fulfillment-proofs/v1/sources/${reservation.uploadId}`,
        "reservation uses the server-assigned private source key",
      );
      const replay = await reserve(actors.operator, first);
      check(
        replay.replayed === true && replay.uploadId === reservation.uploadId,
        "an identical retry replays the same reservation",
      );
      check(
        (
          await reserve(actors.operator, {
            ...first,
            checksumSha256: hex(),
          })
        ).code === "IDEMPOTENCY_CONFLICT",
        "a reused key with different bytes conflicts",
      );
      const [reserved] = await sql(
        "SELECT status,source_object_key FROM fulfillment_proof_uploads WHERE id=$1",
        [reservation.uploadId],
      );
      check(reserved?.status === "RESERVED", "reservation stored as RESERVED");
      check(
        (
          await sql(
            "SELECT count(*)::int n FROM admin_order_operation_receipts WHERE action='BEGIN_PROOF_UPLOAD' AND result_id=$1",
            [reservation.uploadId],
          )
        )[0].n === 1,
        "one BEGIN receipt despite the replay",
      );

      // 3. Completion is limited to the reserving session and records renditions once.
      const read = (actor) =>
        admin(({ adminOrders }) =>
          adminOrders.readProofUpload(
            request(actor, {
              action: "COMPLETE_PROOF_UPLOAD",
              orderId: fixture.order,
              uploadId: reservation.uploadId,
            }),
          ),
        );
      check(
        (await read(actors.operator)).status === "RESERVED",
        "the reserving session reads its reservation",
      );
      check(
        (await read(actors.manager)).code === "NOT_FOUND",
        "another operator cannot complete someone else's upload",
      );
      const result = {
        schemaVersion: 1,
        outcome: "SUCCESS",
        profileVersion: 1,
        uploadId: reservation.uploadId,
        metadataPolicy: "STRIP_ALL_SRGB",
        display: rendition(reservation.uploadId, "1", 1600, 1200),
        thumbnail: rendition(reservation.uploadId, "2", 480, 360),
      };
      const record = () =>
        admin(({ adminOrders }) =>
          adminOrders.completeProofUpload({
            schemaVersion: 1,
            access: actors.operator.access(),
            orderId: fixture.order,
            uploadId: reservation.uploadId,
            source: reservation.source,
            result,
          }),
        );
      check(
        (await record()).kind === "PROOF_UPLOAD",
        "verified renditions are recorded",
      );
      check(
        (await record()).width === 1600,
        "a repeated completion replays the stored result",
      );
      check(
        (
          await sql(
            "SELECT count(*)::int n FROM audit_logs WHERE action='DELIVERY_PROOF_UPLOAD_COMPLETED' AND subject_id=$1",
            [lines.A.fulfillment],
          )
        )[0].n === 1,
        "completion is audited once",
      );

      // 4. Attaching binds the READY upload with privacy confirmation, before delivery.
      const attach = lineCommand(lines.A, {
        action: "ATTACH_PROOFS",
        reasonCode: "DELIVERY_PROOF_CONFIRMED",
        uploadIds: [reservation.uploadId],
        privacyConfirmed: true,
      });
      const attached = await execute(actors.operator, attach);
      check(attached.kind === "MUTATION", "the upload attaches to line A");
      check(
        (await execute(actors.operator, attach)).replayed === true,
        "an attachment retry replays",
      );
      const [proof] = await sql(
        "SELECT id,sequence,privacy_confirmed FROM fulfillment_proofs WHERE upload_id=$1",
        [reservation.uploadId],
      );
      check(
        proof?.sequence === 1 && proof.privacy_confirmed === true,
        "first proof is sequence 1 with confirmed privacy",
      );

      // 5. Fans see nothing until the line is delivered; staff see the pending photo.
      let detail = await fanRead();
      check(
        detail.items.every((item) => item.deliveryProofs.length === 0),
        "a PREPARING line exposes no proof to the fan",
      );
      check(
        (await locate(proof.id)).denied === "ACCESS_DENIED",
        "an undelivered proof cannot be read",
      );
      const staff = await execute(actors.manager, {
        action: "DETAIL",
        orderId: fixture.order,
      });
      const staffLine = staff.items.find(
        (item) => item.fulfillmentId === lines.A.fulfillment,
      );
      check(
        staffLine.proofs.length === 1 &&
          JSON.stringify(staffLine.proofActions) ===
            JSON.stringify(["ATTACH", "WITHDRAW"]),
        "staff see the attached photo and its actions",
      );
      const digitalLine = staff.items.find(
        (item) => item.fulfillmentId === lines.V.fulfillment,
      );
      check(
        digitalLine.proofActions.length === 0 &&
          digitalLine.proofs.length === 0,
        "the digital line offers no proof actions",
      );

      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query(
        "UPDATE fulfillments SET status='DELIVERED',delivered_at=transaction_timestamp() WHERE id=$1",
        [lines.A.fulfillment],
      );
      await client.query("COMMIT");
      detail = await fanRead();
      check(
        isDeepStrictEqual(itemFor(detail, lines.A).deliveryProofs, [
          {
            proofId: proof.id,
            width: 1600,
            height: 1200,
            thumbnailWidth: 480,
            thumbnailHeight: 360,
          },
        ]),
        `the delivered line shows its opaque proof reference: ${JSON.stringify(itemFor(detail, lines.A).deliveryProofs)}`,
      );
      check(
        !JSON.stringify(detail).includes("fulfillment-proofs/"),
        "the fan projection never contains storage keys",
      );
      const thumbnail = await locate(proof.id);
      check(
        thumbnail.rendition?.objectKey === result.thumbnail.objectKey,
        "the session locates the thumbnail rendition",
      );
      check(
        (await locate(proof.id, "display")).rendition?.objectKey ===
          result.display.objectKey,
        "the session locates the display rendition",
      );
      check(
        (await locate(proof.id, "thumbnail", hex())).denied === "ACCESS_DENIED",
        "another browser session cannot read the proof",
      );
      check(
        (await locate(randomUUID())).denied === "ACCESS_DENIED",
        "an unknown proof is indistinguishable from a foreign one",
      );

      // 6. At most three active photos; staff viewing needs delivery authority.
      const second = await ready(actors.operator, lines.A),
        third = await ready(actors.operator, lines.A);
      check(
        (
          await execute(
            actors.operator,
            lineCommand(lines.A, {
              action: "ATTACH_PROOFS",
              reasonCode: "DELIVERY_PROOF_CONFIRMED",
              uploadIds: [second, third],
              privacyConfirmed: true,
            }),
          )
        ).kind === "MUTATION",
        "two more photos attach in one operation",
      );
      check(
        (await reserve(actors.operator, begin(actors.operator, lines.A)))
          .code === "PROOF_LIMIT_REACHED",
        "a fourth active photo is refused",
      );
      const view = (actor) =>
        admin(({ adminOrders }) =>
          adminOrders.readProofRendition(
            request(actor, {
              action: "VIEW_PROOF",
              orderId: fixture.order,
              proofId: proof.id,
              rendition: "display",
            }),
          ),
        );
      check(
        (await view(actors.operator)).identity?.objectKey ===
          result.display.objectKey,
        "delivery staff can locate a rendition for a private grant",
      );
      check(
        (await view(actors.reader)).code === "FORBIDDEN",
        "read-only staff cannot view delivery photos",
      );

      // 7. Withdrawal is manager-only, hides the photo everywhere and frees a slot.
      const withdraw = (actor) =>
        execute(
          actor,
          lineCommand(lines.A, {
            action: "WITHDRAW_PROOF",
            reasonCode: "PROOF_PRIVACY_ISSUE",
            proofId: proof.id,
            confirmed: true,
          }),
        );
      check(
        (await withdraw(actors.operator)).code === "FORBIDDEN",
        "operators cannot withdraw photos",
      );
      check(
        (await withdraw(actors.manager)).kind === "MUTATION",
        "a manager withdraws the photo",
      );
      check(
        (await withdraw(actors.manager)).code === "NOT_FOUND",
        "a withdrawn photo cannot be withdrawn again",
      );
      detail = await fanRead();
      check(
        itemFor(detail, lines.A).deliveryProofs.length === 2 &&
          !itemFor(detail, lines.A).deliveryProofs.some(
            (item) => item.proofId === proof.id,
          ),
        "the fan no longer sees the withdrawn photo",
      );
      check(
        (await locate(proof.id)).denied === "ACCESS_DENIED",
        "a withdrawn photo cannot be read",
      );
      const fourth = await ready(actors.operator, lines.A);
      check(
        (
          await execute(
            actors.operator,
            lineCommand(lines.A, {
              action: "ATTACH_PROOFS",
              reasonCode: "DELIVERY_PROOF_CONFIRMED",
              uploadIds: [fourth],
              privacyConfirmed: true,
            }),
          )
        ).kind === "MUTATION",
        "the freed slot accepts a replacement",
      );
      check(
        (
          await sql(
            "SELECT sequence FROM fulfillment_proofs WHERE upload_id=$1",
            [fourth],
          )
        )[0]?.sequence === 4,
        "sequences continue past withdrawn photos",
      );

      // 8. Storage guards hold even for direct SQL.
      const expectFailure = async (work, code, label) => {
        let failure;
        try {
          await client.query("BEGIN");
          await work();
          await client.query("COMMIT");
        } catch (error) {
          failure = error;
        }
        await client.query("ROLLBACK").catch(() => undefined);
        check(
          errorCode(failure) === code,
          `${label} (expected ${code}, got ${errorCode(failure)})`,
        );
      };
      await expectFailure(
        () =>
          client.query(
            "UPDATE fulfillment_proof_uploads SET display_width=display_width WHERE id=$1",
            [reservation.uploadId],
          ),
        "55000",
        "a READY upload cannot change again",
      );
      await expectFailure(
        () =>
          client.query("DELETE FROM fulfillment_proofs WHERE id=$1", [
            proof.id,
          ]),
        "55000",
        "proofs are append-only",
      );
      await expectFailure(
        () => client.query("TRUNCATE fulfillment_proof_withdrawals"),
        "55000",
        "withdrawals cannot be truncated",
      );
      await expectFailure(
        () =>
          client.query(
            `INSERT INTO fulfillment_proofs(id,order_id,fulfillment_id,upload_id,attachment_id,sequence,actor_id,session_id,audit_log_id,privacy_confirmed)
             SELECT $1,order_id,fulfillment_id,upload_id,$2,99,actor_id,session_id,audit_log_id,true FROM fulfillment_proofs WHERE id=$3`,
            [randomUUID(), randomUUID(), proof.id],
          ),
        "23505",
        "an upload attaches at most once",
      );
      const loose = await ready(actors.operator, lines.B);
      await expectFailure(
        () =>
          client.query(
            `INSERT INTO fulfillment_proofs(id,order_id,fulfillment_id,upload_id,attachment_id,sequence,actor_id,session_id,audit_log_id,privacy_confirmed)
             SELECT $1,order_id,fulfillment_id,id,$2,1,actor_id,session_id,audit_log_id,true FROM fulfillment_proof_uploads WHERE id=$3`,
            [randomUUID(), randomUUID(), loose],
          ),
        "23514",
        "a proof without its exact audit and receipt is rejected at commit",
      );
      await expectFailure(
        () =>
          client.query(
            `INSERT INTO fulfillment_proof_uploads(id,order_id,fulfillment_id,actor_id,session_id,audit_log_id,source_object_key,source_checksum_sha256,source_byte_size,source_mime_type,status,expires_at)
             SELECT $1,order_id,fulfillment_id,actor_id,session_id,$2,'uploads/v1/elsewhere',source_checksum_sha256,source_byte_size,source_mime_type,'RESERVED',transaction_timestamp()+interval '60 seconds' FROM fulfillment_proof_uploads WHERE id=$3`,
            [randomUUID(), randomUUID(), loose],
          ),
        "23514",
        "sources must use the proof namespace key",
      );

      // 9. Rollback refuses to discard delivery evidence.
      // Probe the historical guard directly so a newer registered head cannot produce a false pass
      // merely because runMigrations rejects confirmVersion=0040 before executing the guard.
      await client.query("BEGIN");
      try {
        const down = await readFile(
          path.join(
            workspaceRoot,
            "database/migrations/0040_delivery-proofs.down.sql",
          ),
          "utf8",
        );
        await expectFailure(
          () => client.query(down),
          "55000",
          "0040 down refuses to discard existing delivery evidence",
        );
      } finally {
        await client.query("ROLLBACK");
      }
      check(
        (await sql("SELECT max(version) v FROM schema_migrations"))[0].v ===
          migrated.currentVersion,
        "the current registered schema head is unchanged by the historical rollback probe",
      );
    } catch (error) {
      // The harness replaces callback errors; report only safe classification first.
      console.error(
        "Delivery proof failure:",
        error instanceof assert.AssertionError
          ? error.message
          : JSON.stringify({
              name: error?.name,
              code: error?.code,
              constraint: error?.constraint,
              guard:
                /PL\/pgSQL function ([a-z_][a-z_0-9]{0,127})\(/u.exec(
                  error?.where ?? "",
                )?.[1] ?? null,
            }),
      );
      throw error;
    } finally {
      await persistence.close();
      await client.end();
    }
  });
  console.log(
    `Delivery proof PostgreSQL checks passed (${assertions} assertions).`,
  );
}

try {
  await main();
} catch (error) {
  console.error(
    `Delivery proof PostgreSQL checks failed: ${error instanceof Error ? error.message : "unknown"}`,
  );
  process.exitCode = 1;
}
