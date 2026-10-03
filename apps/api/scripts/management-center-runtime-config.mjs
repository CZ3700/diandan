import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { S3Client, PutBucketCorsCommand } from "@aws-sdk/client-s3";

/** Restore only Next's generated dev-path change after owned web servers stop. */
export async function preserveManagementNextDeclarations(workspaceRoot, own) {
  const normalize = (value) =>
    value.replaceAll(".next/dev/types/", ".next/types/");
  for (const app of ["admin", "storefront"]) {
    const file = path.join(workspaceRoot, "apps", app, "next-env.d.ts");
    const before = await readFile(file, "utf8");
    own(`${app} generated route declarations`, async () => {
      const after = await readFile(file, "utf8");
      if (after !== before && normalize(after) === normalize(before)) {
        await writeFile(file, before);
      }
    });
  }
}

/** Explicit local TEST configuration. The daily operation itself uses one actual operator. */
export async function prepareManagementRuntime({
  client,
  identity,
  s3,
  origin,
  storefrontOrigin,
  base,
  workspaceRoot,
  output,
  own,
  check,
  artistPresentation,
}) {
  const actor = identity.identities.identities.manager,
    permission = randomUUID(),
    role = randomUUID(),
    config = randomUUID();
  await client.query("BEGIN");
  try {
    await client.query(
      "INSERT INTO public.permissions(id,permission_key,description) VALUES($1,'management.direct','Local TEST daily content operator')",
      [permission],
    );
    await client.query(
      "INSERT INTO public.roles(id,role_key,description) VALUES($1,$2,'Local TEST daily content operator')",
      [role, `management:${role}`],
    );
    await client.query(
      "INSERT INTO public.admin_identity_roles(admin_identity_id,role_id,granted_by) VALUES($1,$2,$1)",
      [actor, role],
    );
    await client.query(
      "INSERT INTO public.role_permissions(role_id,permission_id,granted_by) VALUES($1,$2,$3)",
      [role, permission, actor],
    );
    const [market] = (
      await client.query(
        "SELECT market,default_currency FROM public.markets WHERE status='ACTIVE' ORDER BY market LIMIT 1",
      )
    ).rows;
    if (!market) throw new Error("MANAGEMENT_MARKET_NOT_CONFIGURED");
    // Wishes and limited gifts take their stock location from these defaults.
    const [location] = (
      await client.query(
        "SELECT id FROM public.inventory_locations WHERE status='ACTIVE' ORDER BY location_key LIMIT 1",
      )
    ).rows;
    if (!location) throw new Error("MANAGEMENT_LOCATION_NOT_CONFIGURED");
    const presentation = {
      themeAccent: artistPresentation.themeAccent,
      heroTextTone: artistPresentation.heroTextTone,
    };
    await client.query(
      "INSERT INTO public.config_versions(id,config_kind,version,lifecycle,created_by) VALUES($1,'MANAGEMENT_DEFAULTS',1,'DRAFT',$2)",
      [config, actor],
    );
    await client.query(
      "INSERT INTO public.management_defaults(config_version_id,market,currency,inventory_policy,inventory_location_id,eligibility_rule,artist_presentation) VALUES($1,$2,$3,'TRACKED',$4,'ALL_ACTIVE_ARTISTS',$5)",
      [
        config,
        market.market,
        market.default_currency,
        location.id,
        presentation,
      ],
    );
    await client.query(
      "UPDATE public.config_versions SET lifecycle='VALIDATED' WHERE id=$1",
      [config],
    );
    await client.query(
      "UPDATE public.config_versions SET lifecycle='PUBLISHED',published_at=clock_timestamp() WHERE id=$1",
      [config],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  const storage = new S3Client({
    region: "us-east-1",
    endpoint: s3.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: s3.accessKeyId,
      secretAccessKey: s3.secretAccessKey,
    },
  });
  try {
    for (const [Bucket, AllowedMethods] of [
      [s3.sourceBucket, ["PUT"]],
      [s3.derivativeBucket, ["GET", "HEAD"]],
    ])
      await storage.send(
        new PutBucketCorsCommand({
          Bucket,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedOrigins: [origin],
                AllowedMethods,
                AllowedHeaders: ["*"],
                ExposeHeaders: ["ETag", "x-amz-checksum-sha256"],
                MaxAgeSeconds: 60,
              },
            ],
          },
        }),
      );
  } finally {
    storage.destroy();
  }
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith("FAN_SUPPORT_"),
    ),
  );
  Object.assign(environment, {
    NODE_ENV: "development",
    FAN_SUPPORT_DEPLOYMENT_ENV: "development",
    FAN_SUPPORT_SITE_ORIGIN: origin,
    FAN_SUPPORT_INTERNAL_API_ORIGIN: base,
    FAN_SUPPORT_ADMIN_MODE: "TEST",
    FAN_SUPPORT_STOREFRONT_ORIGIN: storefrontOrigin,
    NEXT_TELEMETRY_DISABLED: "1",
  });
  const child = spawn(
    process.execPath,
    [
      path.join(workspaceRoot, "apps/admin/node_modules/next/dist/bin/next"),
      "dev",
      "--hostname",
      "localhost",
      "--port",
      new globalThis.URL(origin).port,
    ],
    {
      cwd: path.join(workspaceRoot, "apps/admin"),
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const secrets = [
    identity.tokenPepper,
    s3.accessKeyId,
    s3.secretAccessKey,
    ...Object.values(identity.credentials).flatMap((value) => [
      value.token,
      value.csrf,
    ]),
  ];
  const log = (chunk) => {
    let text = chunk.toString();
    for (const secret of secrets)
      text = text.replaceAll(secret, "[REDACTED_SECRET]");
    void appendFile(path.join(output, "admin-runtime.log"), text);
  };
  child.stdout.on("data", log);
  child.stderr.on("data", log);
  own("single management Next", async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), delay(5000)]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await once(child, "exit");
    }
  });
  const deadline = globalThis.performance.now() + 90000;
  let ready = false;
  while (globalThis.performance.now() < deadline && child.exitCode === null) {
    try {
      const response = await globalThis.fetch(`${origin}/healthz`, {
        signal: globalThis.AbortSignal.timeout(2000),
      });
      await response.body?.cancel();
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // The owned Next process may not yet be accepting connections.
    }
    await delay(200);
  }
  check(ready, "single management center is reachable");
  return { origin, operatorId: actor };
}
