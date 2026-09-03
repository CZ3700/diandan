import type {
  CreateAuthorizationRequestCommand,
  CreateAuthorizationRequestResponse,
  ExchangeAuthorizationCodeCommand,
  ExchangeAuthorizationCodeResponse,
} from "@fan-support/contracts";

export {
  identityPortCommandSchema,
  identityPortErrorCodeSchema,
  identityPortErrorSchema,
  identityPortOperationSchema,
  identityPortResponseSchema,
} from "@fan-support/contracts";
export type {
  CreateAuthorizationRequestCommand,
  CreateAuthorizationRequestResponse,
  ExchangeAuthorizationCodeCommand,
  ExchangeAuthorizationCodeResponse,
  IdentityPortCommand,
  IdentityPortError,
  IdentityPortFailure,
  IdentityPortResponse,
} from "@fan-support/contracts";

export interface IdentityProvider {
  createAuthorizationRequest(
    command: CreateAuthorizationRequestCommand,
  ): Promise<CreateAuthorizationRequestResponse>;
  exchangeAuthorizationCode(
    command: ExchangeAuthorizationCodeCommand,
  ): Promise<ExchangeAuthorizationCodeResponse>;
}

export const workspacePackageName = "@fan-support/identity-port" as const;
