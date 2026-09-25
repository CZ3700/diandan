import type {
  MediaProcessingEnqueueCommand,
  MediaProcessingReadCommand,
  MediaProcessingClaimCommand,
  MediaProcessingCompleteCommand,
  MediaProcessingFailCommand,
  MediaProcessingSnapshotResponse,
  MediaProcessingClaimResponse,
} from "@fan-support/contracts";
import type { JsonValue } from "./index.js";
export interface MediaProcessingRepository {
  enqueue(
    command: MediaProcessingEnqueueCommand,
  ): Promise<MediaProcessingSnapshotResponse>;
  read(
    command: MediaProcessingReadCommand,
  ): Promise<MediaProcessingSnapshotResponse>;
  claim(
    command: MediaProcessingClaimCommand,
  ): Promise<MediaProcessingClaimResponse>;
  complete(
    command: MediaProcessingCompleteCommand,
  ): Promise<MediaProcessingSnapshotResponse>;
  fail(
    command: MediaProcessingFailCommand,
  ): Promise<MediaProcessingSnapshotResponse>;
}
export type MediaProcessingRepositories = Readonly<{
  mediaProcessing: MediaProcessingRepository;
}>;
export interface MediaProcessingTransactionManager {
  runInMediaProcessingTransaction<Result extends JsonValue>(
    work: (repositories: MediaProcessingRepositories) => Promise<Result>,
  ): Promise<Result>;
}
