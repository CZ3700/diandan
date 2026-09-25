import assert from "node:assert/strict";
import { serializePublicationManifest } from "@fan-support/content";

export async function verifyPublicationRevisionProof(client, manifest, check) {
  manifest = JSON.parse(serializePublicationManifest(manifest));
  await client.query(
    "SELECT public.assert_publication_manifest_revision($1::jsonb)",
    [JSON.stringify(manifest.revision)],
  );
  check(true, true, "canonical revision matches actual SQL facts");
  const mutations = [
    [
      "missing required parent proof",
      (value) => {
        delete value.createdBy;
      },
    ],
    [
      "altered actual translation",
      (value) => {
        const fields = value.content.translations[0].fields;
        fields[
          Object.keys(fields).find((key) => typeof fields[key] === "string")
        ] += "x";
      },
    ],
    [
      "invented terminal review",
      (value) => {
        value.translationAudits[0].reviewId =
          "00000000-0000-4000-8000-000000000000";
      },
    ],
  ];
  if (manifest.revision.extensions.aliases)
    mutations.push([
      "omitted aliases",
      (value) => {
        delete value.extensions.aliases;
      },
    ]);
  if (manifest.revision.extensions.details)
    mutations.push([
      "omitted details",
      (value) => {
        delete value.extensions.details;
      },
    ]);
  for (const [label, mutate] of mutations) {
    const value = globalThis.structuredClone(manifest.revision);
    mutate(value);
    await client.query("SAVEPOINT proof_rejection");
    let error;
    try {
      await client.query(
        "SELECT public.assert_publication_manifest_revision($1::jsonb)",
        [JSON.stringify(value)],
      );
    } catch (failure) {
      error = failure;
    }
    await client.query("ROLLBACK TO SAVEPOINT proof_rejection");
    await client.query("RELEASE SAVEPOINT proof_rejection");
    assert.equal(error?.code, "23514", label);
    check(true, true, `${label} rejected by database proof`);
  }
  for (const [fn, mutations] of [
    [
      "assert_publication_manifest_approvals",
      [
        [
          "omitted base approval",
          (value) => {
            value.approvals.pop();
          },
        ],
        ...(manifest.copies.length
          ? [
              [
                "invented copy receipt",
                (value) => {
                  value.copies[0].authoringReceiptId =
                    "00000000-0000-4000-8000-000000000000";
                },
              ],
            ]
          : []),
        ...(manifest.extensionApprovals.length
          ? [
              [
                "omitted extension approval",
                (value) => {
                  value.extensionApprovals.pop();
                },
              ],
            ]
          : []),
      ],
    ],
    [
      "assert_publication_manifest_media",
      manifest.media.assets.length
        ? [
            [
              "omitted referenced media",
              (value) => {
                value.media.assets.pop();
              },
            ],
            [
              "forged binary dimensions",
              (value) => {
                value.media.assets[0].width++;
              },
            ],
            [
              "omitted media lineage",
              (value) => {
                value.media.lineage.pop();
              },
            ],
            [
              "empty variant evidence",
              (value) => {
                value.media.variants = [];
              },
            ],
          ]
        : [],
    ],
  ]) {
    await client.query(`SELECT public.${fn}($1::jsonb)`, [
      JSON.stringify(manifest),
    ]);
    check(true, true, `${fn} accepts canonical actual facts`);
    for (const [label, mutate] of mutations) {
      const altered = globalThis.structuredClone(manifest);
      mutate(altered);
      await client.query("SAVEPOINT proof_rejection");
      let error;
      try {
        await client.query(`SELECT public.${fn}($1::jsonb)`, [
          JSON.stringify(altered),
        ]);
      } catch (failure) {
        error = failure;
      }
      await client.query("ROLLBACK TO SAVEPOINT proof_rejection");
      await client.query("RELEASE SAVEPOINT proof_rejection");
      check(error?.code, "23514", label);
    }
  }
}
