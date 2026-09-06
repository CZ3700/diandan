import type {
  MediaImageProcessingCommand,
  MediaImageProcessingResult,
} from "@fan-support/contracts";
/** Performs storage and image processing outside the database transaction. No bytes or signed URLs cross this boundary. */
export interface MediaImageProcessingPort {
  process(
    command: MediaImageProcessingCommand,
  ): Promise<MediaImageProcessingResult>;
}
