import type {
  GetCachePurgeStatusCommand,
  GetCachePurgeStatusResponse,
  SubmitCachePurgeCommand,
  SubmitCachePurgeResponse,
} from "@fan-support/contracts";

export {
  cachePurgePathSchema,
  cachePurgePortCommandSchema,
  cachePurgePortErrorCodeSchema,
  cachePurgePortErrorSchema,
  cachePurgePortOperationSchema,
  cachePurgePortResponseSchema,
  cachePurgeStatusSchema,
} from "@fan-support/contracts";
export type {
  CachePurgePortCommand,
  CachePurgePortError,
  CachePurgePortFailure,
  CachePurgePortResponse,
  GetCachePurgeStatusCommand,
  GetCachePurgeStatusResponse,
  SubmitCachePurgeCommand,
  SubmitCachePurgeResponse,
} from "@fan-support/contracts";

export interface CachePurgePort {
  submitPurge(
    command: SubmitCachePurgeCommand,
  ): Promise<SubmitCachePurgeResponse>;
  getPurgeStatus(
    command: GetCachePurgeStatusCommand,
  ): Promise<GetCachePurgeStatusResponse>;
}

export const workspacePackageName = "@fan-support/cache-purge-port" as const;
