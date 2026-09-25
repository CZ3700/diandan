import { createLocalExperienceFetch } from "./local-experience-services-common.mjs";
/** Probe each actual application, without treating a live supervisor as a healthy platform. */
export async function probeLocalApplications(
  config,
  { fetcher = globalThis.fetch } = {},
) {
  const ports = {
    api: config.ports.api,
    worker: config.ports.worker,
    storefront: config.ports.storefrontBackend,
    admin: config.ports.adminBackend,
  };
  const localFetch = config.origins
    ? await createLocalExperienceFetch({
        origins: [config.origins.storefront, config.origins.admin],
        caCertificatePath: config.tls.caCertificatePath,
      })
    : undefined;
  const entries = await Promise.all(
    Object.entries(ports).map(async ([name, port]) => {
      try {
        const webOrigin = config.origins?.[name];
        const transport = webOrigin ? localFetch : fetcher;
        const response = await transport(
          `${webOrigin ?? `http://127.0.0.1:${port}`}/healthz`,
          {
            signal: globalThis.AbortSignal.timeout(2000),
          },
        );
        await response.body?.cancel();
        return [name, response.status === 200];
      } catch {
        return [name, false];
      }
    }),
  );
  const services = Object.fromEntries(entries);
  return { ready: entries.every(([, healthy]) => healthy), services };
}
