import {
  observedManagementPersistence,
  observeManagementOperations,
} from "./management-center-diagnostics.mjs";
import { createMediaImageProcessor } from "@fan-support/media-image";
import { createServer } from "node:http";
import { Client, Pool } from "pg";
import { createStructuredLogger } from "@fan-support/observability";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import {
  createCatalogDirectoryUseCases,
  createPublishedGiftCommerceUseCases,
} from "@fan-support/application";
import {
  createPostgresPersistence,
  runMigrations,
} from "@fan-support/persistence-postgres";
import { createApiApplication } from "../dist/bootstrap.js";
import {
  createTestAdminWorkspaceComposition,
  createTestContentAuthoringComposition,
  createTestBaseContentComposition,
  createTestAdminContentComposition,
  createTestResourceManagementComposition,
  createTestPublicationPreflightComposition,
  createTestPublicationRuntimeComposition,
  createTestGiftCommerceComposition,
  createTestAdminSessionComposition,
  createTestManagementCenterComposition,
} from "../dist/index.js";
import { createWorkerMediaProcessingComposition } from "../../worker/dist/media-processing-composition.js";
import { createMediaProcessingWorkerRuntime } from "../../worker/dist/media-processing-runtime.js";
import {
  publicationMediaEnvironment,
  createPublicationMediaFixture,
} from "./publication-runtime-http-media.mjs";
import { preflightEnvironment } from "./publication-preflight-http-fixtures.mjs";
import { giftCommerceExtension } from "./gift-commerce-http-fixtures.mjs";
import {
  createStorefrontFixtureIdentity,
  createStorefrontContentClient,
} from "./storefront-content-client.mjs";
import {
  createStorefrontMediaGateway,
  createStorefrontMediaPublisher,
} from "./storefront-media-fixtures.mjs";
import {
  createGiftStorefrontFaultGateway,
  createGiftStorefrontNext,
} from "./gift-storefront-next.mjs";
import { buildAcceptanceHomepageContent } from "./storefront-acceptance-fixtures.mjs";
import { seedGiftStorefront } from "./gift-storefront-fixtures.mjs";
import {
  prepareManagementRuntime,
  preserveManagementNextDeclarations,
} from "./management-center-runtime-config.mjs";
import { withAcceptanceResources } from "./storefront-acceptance-lifecycle.mjs";

async function reserveOrigin() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://localhost:${server.address().port}`;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return origin;
}

/** Credentials and mutable fixture controls remain callback-local, never part of the persisted manifest. */
export async function withManagementCenterRuntime({
  database,
  s3,
  workspaceRoot,
  output,
  check,
  progress,
  verify,
}) {
  if (typeof verify !== "function")
    throw new TypeError("Acceptance verification callback is required");
  return withAcceptanceResources(async (own) => {
    await preserveManagementNextDeclarations(workspaceRoot, own);
    await runMigrations({
      clientConfig: database,
      workspaceRoot,
      command: { direction: "up" },
    });
    const client = new Client(database);
    client.on("error", () => undefined);
    own("fixture observer PostgreSQL", () => client.end());
    await client.connect();
    const origin = await reserveOrigin();
    const adminOrigin = await reserveOrigin();
    const identity = await createStorefrontFixtureIdentity(client);
    await giftCommerceExtension.seed({
      client,
      identities: identity.identities,
      check,
    });
    const publicMediaPool = new Pool({ ...database, max: 2 });
    publicMediaPool.on("error", () => undefined);
    own("public media PostgreSQL", () => publicMediaPool.end());
    const gateway = await createStorefrontMediaGateway({
      s3,
      configPath: process.env.FAN_SUPPORT_MEDIA_S3_TEST_CONFIG,
      currentPublicClient: publicMediaPool,
    });
    own("owned TLS media gateway", () => gateway.close());
    const media = createPublicationMediaFixture(s3);
    const common = {
      environment: "TEST",
      database,
      tokenPepper: identity.tokenPepper,
      allowedOrigin: adminOrigin,
    };
    const logger = createStructuredLogger({
      service: "api",
      write: () => undefined,
    });
    const environment = {
      ...publicationMediaEnvironment(preflightEnvironment(database), s3),
      FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN: gateway.origin,
    };
    const persistence = createPostgresPersistence(database, {
      catalogPublicMediaBaseUrl: gateway.origin,
    });
    own("public read persistence", () => persistence.close());
    let appClosed = false;
    const compositions = [];
    // Register each composition immediately so later initialization failures cannot leak its pool.
    const add = (composition) => {
      compositions.push(composition);
      for (const [name, runtime] of Object.entries(composition)) {
        if (name.endsWith("Runtime") || name.endsWith("Lifecycle"))
          own(name, () => (appClosed ? undefined : runtime.stop()));
      }
    };
    add(createTestAdminSessionComposition(common));
    const management = createTestManagementCenterComposition(
      {
        ...common,
        ...media,
        processor: createMediaImageProcessor({
          storage: media.storage,
          now: () => new Date(),
        }),
        publicMediaBaseUrl: gateway.origin,
        leaseSeconds: 300,
      },
      { createPersistence: observedManagementPersistence(output) },
    );
    add({
      ...management,
      managementCenterRuntime: {
        start: async () => undefined,
        stop: () => management.managementCenterRuntime.stop(),
      },
    });
    add(
      createTestAdminWorkspaceComposition({
        ...common,
        publicMediaBaseUrl: gateway.origin,
        storage: media.storage,
      }),
    );
    add(createTestContentAuthoringComposition(common));
    add(createTestBaseContentComposition(common));
    add(createTestAdminContentComposition(common));
    add(createTestResourceManagementComposition({ ...common, ...media }));
    add(createTestPublicationPreflightComposition(common));
    add(
      createTestPublicationRuntimeComposition({
        ...common,
        publicMediaBaseUrl: gateway.origin,
      }),
    );
    add(
      createTestGiftCommerceComposition({
        ...common,
        publicMediaBaseUrl: gateway.origin,
      }),
    );
    const app = await createApiApplication(
      environment,
      Object.assign(
        {
          logger,
          catalogDirectoryRoute: createCatalogDirectoryUseCases({
            transactions: persistence.contentReadTransactionManager,
          }),
          publishedGiftCommerceRoute: {
            useCases: createPublishedGiftCommerceUseCases({
              transactions: persistence.publishedGiftCommerceTransactionManager,
            }),
          },
        },
        ...compositions,
      ),
    );
    own("owned API", async () => {
      await app.close();
      appClosed = true;
    });
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    let workerRuntime;
    const worker = await createWorkerMediaProcessingComposition(environment, {
      logger,
      factories: {
        createRuntime(options) {
          workerRuntime = createMediaProcessingWorkerRuntime({
            ...options,
            schedule: () => ({ cancel() {} }),
          });
          return workerRuntime;
        },
      },
    });
    own("actual image processing worker", () => worker.stop());
    await worker.start();
    const content = createStorefrontContentClient({
      base,
      origin: adminOrigin,
      credentials: identity.credentials,
      check,
    });
    const provenance = [];
    const publishMedia = createStorefrontMediaPublisher({
      content,
      workerRuntime,
      client,
      gateway,
      check,
      provenance,
    });
    const fixtures = await seedGiftStorefront({
      workspaceRoot,
      content,
      publishMedia,
      client,
      check,
      progress,
    });
    for (const artist of fixtures.artists.filter(
      (artist) => !artist.acceptingGifts,
    )) {
      const current = await content.request(
        "/api/v1/admin/catalog/owners/read",
        { target: artist.owner, locale: "en" },
      );
      await content.write("/api/v1/admin/catalog/idols/status", {
        idolId: artist.id,
        status: "active",
        acceptingGifts: true,
        expectedBaseVersion: current.owner.baseVersion,
      });
      artist.acceptingGifts = true;
    }
    const firstArtist = fixtures.artists.find(
      (artist) => artist.acceptingGifts,
    );
    const original = await content.request(
      "/api/v1/admin/content-authoring/read",
      { target: firstArtist.owner, revisionId: firstArtist.revisionId },
    );
    const owner = { kind: "HOMEPAGE" };
    const homepageRevision = await content.author(
      owner,
      buildAcceptanceHomepageContent({
        ...fixtures,
        hero: original.snapshot.content,
      }),
    );
    await content.approve(owner, homepageRevision);
    const homepage = await content.publish(owner, homepageRevision);
    fixtures.homepage = {
      owner,
      revisionId: homepageRevision,
      publicationId: homepage.publicationId,
    };
    const admin = await prepareManagementRuntime({
      client,
      identity,
      s3,
      origin: adminOrigin,
      storefrontOrigin: origin,
      base,
      workspaceRoot,
      output,
      own,
      check,
      artistPresentation: original.snapshot.content.structure,
    });
    const diagnosticsClient = new Client(database);
    diagnosticsClient.on("error", () => undefined);
    own("management diagnostics PostgreSQL", () => diagnosticsClient.end());
    await diagnosticsClient.connect();
    observeManagementOperations({ client: diagnosticsClient, output, own });
    await management.managementCenterRuntime.start();
    let next, proxy;
    async function startStorefront() {
      if (!next) {
        proxy = await createGiftStorefrontFaultGateway(base);
        own("owned API fault gateway", () => proxy.close());
        next = createGiftStorefrontNext({
          workspaceRoot,
          origin,
          proxy,
          gateway,
          output,
          production: false,
          check,
          secrets: [
            database.password,
            s3.secretAccessKey,
            s3.accessKeyId,
            identity.tokenPepper,
            ...Object.values(identity.credentials).flatMap((value) => [
              value.token,
              value.csrf,
            ]),
          ],
        });
        own("owned compiled Next", () => next.stop());
      }
      await next.start();
      return { next, proxy };
    }
    const manifest = {
      schemaVersion: 1,
      environment: "TEST",
      artistCount: fixtures.artists.length,
      visibleGiftCount: fixtures.gifts.filter((gift) =>
        ["active", "paused"].includes(gift.status),
      ).length,
      policyCount: fixtures.policies.length,
      locales: SUPPORTED_LOCALES,
      markets: fixtures.markets,
      homepage: fixtures.homepage,
      artists: fixtures.artists.map(
        ({ id, handle, revisionId, acceptingGifts }) => ({
          id,
          handle,
          revisionId,
          acceptingGifts,
        }),
      ),
      gifts: fixtures.gifts.map(({ id, handle, revisionId, status }) => ({
        id,
        handle,
        revisionId,
        status,
      })),
      policies: fixtures.policies,
      syntheticMediaCompositions: provenance,
      formalAssetApproval: false,
      humanOperationsEvidence: false,
      physicalDeviceEvidence: false,
      productionReleaseEvidence: false,
    };
    return verify({
      adminOrigin,
      admin,
      base,
      origin,
      output,
      fixtures,
      manifest,
      content,
      gateway,
      persistence,
      client,
      identity,
      startStorefront,
      own,
      check,
      progress,
    });
  });
}
