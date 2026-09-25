import { paymentPortCommandSchema } from "@fan-support/contracts";
/** An opt-in TEST protocol facade; its accepted commands use the same independent durable PSP ledger. */
export function readTestNormalizedPaymentCommand(body, headers, settings) {
  if (
    !body ||
    body.schemaVersion !== 1 ||
    body.protocol !== "fan-support-gateway-v1" ||
    body.merchantAccount !== settings.merchantAccount
  )
    throw new TypeError("Invalid owned TEST gateway envelope");
  const command = paymentPortCommandSchema.parse(body.command);
  const create = command.operation === "CREATE_PAYMENT",
    capabilities = command.operation === "GET_CAPABILITIES";
  const keys = [
    "schemaVersion",
    "protocol",
    "merchantAccount",
    "command",
    ...(create ? ["instrument"] : capabilities ? ["instruments"] : []),
  ];
  if (
    Object.keys(body).sort().join(",") !== keys.sort().join(",") ||
    command.providerAccountId !== settings.providerAccountId ||
    command.environment !== "TEST"
  )
    throw new TypeError("Invalid owned TEST gateway identity");
  if (
    capabilities &&
    JSON.stringify(body.instruments) !== JSON.stringify(settings.instruments)
  )
    throw new TypeError("Invalid owned TEST gateway instruments");
  if (
    create &&
    JSON.stringify(body.instrument) !==
      JSON.stringify(
        settings.instruments.find(
          (value) => value.paymentMethod === command.paymentMethod,
        ),
      )
  )
    throw new TypeError("Invalid owned TEST gateway instrument");
  const key = create
    ? command.providerIdempotencyKey
    : ["CANCEL_PAYMENT", "REFUND_PAYMENT"].includes(command.operation)
      ? command.idempotencyKey
      : undefined;
  if (key !== headers["idempotency-key"])
    throw new TypeError("Invalid owned TEST gateway idempotency");
  return command;
}
