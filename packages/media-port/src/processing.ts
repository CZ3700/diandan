import type {
  MediaImageProcessingCommand,
  MediaImageProcessingResult,
  MediaSourceInspectionCommand,
  MediaSourceInspectionResponse,
} from "@fan-support/contracts";
/** Performs storage and image processing outside the database transaction. No bytes or signed URLs cross this boundary. */
export interface MediaImageProcessingPort {
  process(
    command: MediaImageProcessingCommand,
  ): Promise<MediaImageProcessingResult>;
}

/** Checks actual private source bytes outside a database transaction; returns no bytes, EXIF or capability URL. */
export interface MediaSourceInspectionPort {
  inspect(
    command: MediaSourceInspectionCommand,
  ): Promise<MediaSourceInspectionResponse>;
}
