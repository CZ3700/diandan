import {
  createAdminAccessUseCases,
  createAdminLocalAccessUseCases,
  createAdminSessionUseCases,
} from "@fan-support/application";
import type { KeyManagementPort } from "@fan-support/key-management-port";
import {
  adminAccessSettingsSchema,
  type AdminAccessSettings,
} from "@fan-support/contracts";
import {
  createOidcIdentityProvider,
  type OidcIdentityProviderOptions,
  type OidcIdentityProviderDependencies,
} from "@fan-support/identity-oidc";
import {
  createPostgresPersistence,
  type PostgresConnectionConfig,
  type PostgresPersistence,
} from "@fan-support/persistence-postgres";
import type { ApiLifecycleResource } from "../bootstrap.js";
import type {
  AdminAccessRouteDependencies,
  AdminLocalAccessRouteDependencies,
} from "../admin-access-route.js";
import type { AdminAccountRouteDependencies } from "../admin-account-route.js";
import type { AdminSessionRouteDependencies } from "../admin-session-route.js";
type Persistence = Pick<
  PostgresPersistence,
  "adminAccessTransactionManager" | "adminSessionTransactionManager" | "close"
>;
export type LocalOidcAdminAccessCompositionOptions = Readonly<{
  environment: "LOCAL_OIDC";
  database: PostgresConnectionConfig;
  settings: AdminAccessSettings;
  provider: OidcIdentityProviderOptions;
  tokenPepper: string;
  subjectPepper: string;
  accessKey: string;
  allowedOrigin: string;
}>;
/** Real OIDC protocol with local development composition; no production enrollment is implied. */
export function createLocalOidcAdminAccessComposition(
  options: LocalOidcAdminAccessCompositionOptions,
  dependencies: Readonly<{
    createPersistence?: (database: PostgresConnectionConfig) => Persistence;
    identityTransport?: OidcIdentityProviderDependencies;
  }> = {},
): Readonly<{
  adminAccessRoute: AdminAccessRouteDependencies;
  adminSessionRoute: AdminSessionRouteDependencies;
  adminAccessRuntime: ApiLifecycleResource;
}> {
  const settings = adminAccessSettingsSchema.parse(options.settings);
  const origin = new URL(options.allowedOrigin);
  if (
    options.environment !== "LOCAL_OIDC" ||
    origin.origin !== options.allowedOrigin ||
    origin.protocol !== "https:" ||
    settings.redirectUri !== `${origin.origin}/api/admin/auth/callback` ||
    settings.issuer !== options.provider.issuer ||
    settings.clientId !== options.provider.clientId ||
    settings.redirectUri !== options.provider.redirectUri ||
    [options.tokenPepper, options.subjectPepper, options.accessKey].some(
      (v) => typeof v !== "string" || !/^[a-f0-9]{64}$/u.test(v),
    ) ||
    options.tokenPepper === options.subjectPepper
  )
    throw new TypeError("Invalid local admin access configuration");
  const identityProvider = createOidcIdentityProvider(
    {
      ...options.provider,
      maxAuthenticationAgeSeconds: settings.maxAuthenticationAgeSeconds,
      clockSkewSeconds: 0,
    },
    dependencies.identityTransport,
  );
  const persistence = (
    dependencies.createPersistence ?? createPostgresPersistence
  )(options.database);
  let closing: Promise<void> | undefined;
  const stop = () =>
    (closing ??= Promise.resolve().then(() => persistence.close()));
  try {
    return Object.freeze({
      adminAccessRoute: {
        allowedOrigin: options.allowedOrigin,
        accessKey: options.accessKey,
        useCases: createAdminAccessUseCases({
          settings,
          identityProvider,
          tokenPepper: options.tokenPepper,
          subjectPepper: options.subjectPepper,
          transactions: persistence.adminAccessTransactionManager,
        }),
      },
      adminSessionRoute: {
        allowedOrigin: options.allowedOrigin,
        useCases: createAdminSessionUseCases({
          tokenPepper: options.tokenPepper,
          transactions: persistence.adminSessionTransactionManager,
        }),
      },
      adminAccessRuntime: { start: async () => undefined, stop },
    });
  } catch {
    void stop().catch(() => undefined);
    throw new TypeError("Local admin access construction failed");
  }
}

export type LocalAccountAdminAccessCompositionOptions = Readonly<{
  environment: "LOCAL_ACCOUNT";
  database: PostgresConnectionConfig;
  keyManagement: Pick<KeyManagementPort, "encryptEnvelope" | "decryptEnvelope">;
  tokenPepper: string;
  subjectPepper: string;
  accessKey: string;
  allowedOrigin: string;
  totpIssuer?: string;
}>;
/** ADR-021 built-in accounts for the local experience and the remote TEST instance. */
export function createLocalAccountAdminAccessComposition(
  options: LocalAccountAdminAccessCompositionOptions,
  dependencies: Readonly<{
    createPersistence?: (
      database: PostgresConnectionConfig,
    ) => Pick<
      PostgresPersistence,
      "adminLocalAccessTransactionManager" | "close"
    >;
  }> = {},
): Readonly<{
  adminLocalAccessRoute: AdminLocalAccessRouteDependencies;
  adminAccountRoute: AdminAccountRouteDependencies;
  adminLocalAccessRuntime: ApiLifecycleResource;
}> {
  const origin = new URL(options.allowedOrigin);
  if (
    options.environment !== "LOCAL_ACCOUNT" ||
    origin.origin !== options.allowedOrigin ||
    origin.protocol !== "https:" ||
    [options.tokenPepper, options.subjectPepper, options.accessKey].some(
      (v) => typeof v !== "string" || !/^[a-f0-9]{64}$/u.test(v),
    ) ||
    new Set([options.tokenPepper, options.subjectPepper, options.accessKey])
      .size !== 3
  )
    throw new TypeError("Invalid local account admin access configuration");
  const persistence = (
    dependencies.createPersistence ?? createPostgresPersistence
  )(options.database);
  let closing: Promise<void> | undefined;
  const stop = () =>
    (closing ??= Promise.resolve().then(() => persistence.close()));
  try {
    const useCases = createAdminLocalAccessUseCases({
      transactions: persistence.adminLocalAccessTransactionManager,
      keys: options.keyManagement,
      tokenPepper: options.tokenPepper,
      subjectPepper: options.subjectPepper,
      totpIssuer: options.totpIssuer ?? "Studio Admin",
    });
    return Object.freeze({
      adminLocalAccessRoute: {
        allowedOrigin: options.allowedOrigin,
        accessKey: options.accessKey,
        useCases,
      },
      adminAccountRoute: { allowedOrigin: options.allowedOrigin, useCases },
      adminLocalAccessRuntime: { start: async () => undefined, stop },
    });
  } catch {
    void stop().catch(() => undefined);
    throw new TypeError("Local account admin access construction failed");
  }
}
