import {
  paymentAccountConnectionSchema,
  paymentConfigurationDeployedAccountsSchema,
  paymentConfigurationPublishedProjectionSchema,
  paymentHealthPolicySchema,
  type PaymentAccountConnection,
  type PaymentHealthPolicy,
} from "@fan-support/contracts";
import {
  createPaymentConnectorRegistry,
  type PaymentConnectorFactory,
} from "@fan-support/payment-gateway";
const identity = (value: { providerAccountId: string; environment: string }) =>
  `${value.environment}/${value.providerAccountId.toLowerCase()}`;
function immutable<Value>(value: Value): Value {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}
/** The database publishes rules; this projection only selects statically deployed immutable connector identities. */
export function createPaymentConfigurationRuntime(
  options: Readonly<{
    connections: readonly PaymentAccountConnection[];
    factories: readonly PaymentConnectorFactory[];
    initialProviderAccountIds?: readonly string[];
    initialPolicies: readonly PaymentHealthPolicy[];
    readPublished(): Promise<unknown>;
  }>,
) {
  const connections = options.connections.map((value) =>
    immutable(paymentAccountConnectionSchema.parse(value)),
  );
  const byAccount = new Map(
    connections.map((value) => [
      value.binding.providerAccountId.toLowerCase(),
      value,
    ]),
  );
  if (connections.length > 100 || byAccount.size !== connections.length)
    throw new TypeError("Invalid deployed payment connections");
  // Registry validation checks actual deployed factory capabilities before exposing safe administration descriptors.
  const deployed = createPaymentConnectorRegistry(options.factories);
  deployed.applyPublishedSnapshot({
    schemaVersion: 1,
    revision: 1,
    connections,
  });
  const deployedAccounts = immutable(
    paymentConfigurationDeployedAccountsSchema.parse(
      connections.map((value) => ({
        providerAccountId: value.binding.providerAccountId,
        environment: value.binding.environment,
        adapterKey: value.binding.providerCode,
        adapterVersion: value.adapterVersion,
        paymentMethods: value.instruments.map(
          (instrument) => instrument.paymentMethod,
        ),
      })),
    ),
  );
  const initialIds = new Set(
    (
      options.initialProviderAccountIds ??
      connections.map((value) => value.binding.providerAccountId)
    ).map((value) => value.toLowerCase()),
  );
  if (
    initialIds.size !==
      (options.initialProviderAccountIds?.length ?? connections.length) ||
    [...initialIds].some((id) => !byAccount.has(id))
  )
    throw new TypeError("Invalid initial payment accounts");
  const initial = deployed.directory
    .getRegistrations()
    .filter((entry) =>
      initialIds.has(entry.configuration.providerAccountId.toLowerCase()),
    );
  const initialPolicies = immutable(
    options.initialPolicies.map((value) =>
      paymentHealthPolicySchema.parse(value),
    ),
  );
  let policies = initialPolicies;
  function validatePolicies(
    next: readonly PaymentHealthPolicy[],
    accounts: readonly { providerAccountId: string; environment: string }[],
  ) {
    const indexed = new Map(next.map((value) => [identity(value), value]));
    if (
      indexed.size !== next.length ||
      next.length !== accounts.length ||
      accounts.some((value) => !indexed.has(identity(value)))
    )
      throw new TypeError("Incomplete published payment health policies");
    for (const prior of policies) {
      const current = indexed.get(identity(prior));
      if (
        !current ||
        current.version < prior.version ||
        (current.version === prior.version &&
          JSON.stringify(current) !== JSON.stringify(prior))
      )
        throw new TypeError("Invalid published payment health version");
    }
  }
  validatePolicies(
    policies,
    initial.map((entry) => entry.configuration),
  );
  const registry = createPaymentConnectorRegistry(options.factories);
  let generation = 0,
    snapshot: string | undefined,
    pending: Promise<void> | undefined;
  let publishedAccounts: readonly string[] = [];
  async function load() {
    const raw = await options.readPublished();
    if (raw === null) {
      if (generation !== 0)
        throw new TypeError("Published payment configuration disappeared");
      return;
    }
    const projection = paymentConfigurationPublishedProjectionSchema.parse(raw);
    const serialized = JSON.stringify(projection);
    if (
      projection.generation < generation ||
      (projection.generation === generation && serialized !== snapshot)
    )
      throw new TypeError("Stale payment configuration projection");
    if (projection.generation === generation) return;
    const managed = projection.accounts.map((account) => {
      const value = byAccount.get(account.providerAccountId.toLowerCase());
      if (
        !value ||
        value.binding.environment !== account.environment ||
        value.binding.providerCode !== account.adapterKey
      )
        throw new TypeError("Published payment adapter unavailable");
      return value;
    });
    const nextIds = new Set(
      managed.map((value) => value.binding.providerAccountId.toLowerCase()),
    );
    if (publishedAccounts.some((id) => !nextIds.has(id)))
      throw new TypeError("Historical payment account missing");
    const selected = [
      ...connections.filter(
        (value) =>
          initialIds.has(value.binding.providerAccountId.toLowerCase()) &&
          !nextIds.has(value.binding.providerAccountId.toLowerCase()),
      ),
      ...managed,
    ];
    const managedPolicyIds = new Set(projection.policies.map(identity));
    if (
      managedPolicyIds.size !== projection.accounts.length ||
      projection.accounts.some(
        (account) => !managedPolicyIds.has(identity(account)),
      )
    )
      throw new TypeError("Incomplete published payment health policies");
    const nextPolicies = immutable([
      ...initialPolicies.filter(
        (policy) => !managedPolicyIds.has(identity(policy)),
      ),
      ...projection.policies,
    ]);
    validatePolicies(
      nextPolicies,
      selected.map((value) => value.binding),
    );
    registry.applyPublishedSnapshot({
      schemaVersion: 1,
      revision: projection.generation,
      connections: selected,
    });
    // No awaited work between directory activation and policy visibility.
    policies = nextPolicies;
    snapshot = serialized;
    generation = projection.generation;
    publishedAccounts = [...nextIds];
  }
  return Object.freeze({
    deployedAccounts,
    get generation() {
      return generation;
    },
    providerDirectory: Object.freeze({
      getRegistrations: () =>
        generation === 0 ? initial : registry.directory.getRegistrations(),
    }),
    readPolicies: (): readonly PaymentHealthPolicy[] => policies,
    refresh(): Promise<void> {
      if (!pending) {
        pending = load().finally(() => {
          pending = undefined;
        });
      }
      return pending;
    },
  });
}
export type PaymentConfigurationRuntime = ReturnType<
  typeof createPaymentConfigurationRuntime
>;
