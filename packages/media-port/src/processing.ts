import type {
  StorefrontLogoProcessingCommand,
  StorefrontLogoProcessingResult,
  DeliveryProofProcessingCommand,
  DeliveryProofProcessingResult,
  DeliveryProofReadCommand,
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

/**
 * Verifies one private delivery photo and writes metadata-free renditions to private storage only.
 * Runs outside database transactions; no bytes or signed URLs cross this boundary.
 */
export interface DeliveryProofProcessingPort {
  process(
    command: DeliveryProofProcessingCommand,
  ): Promise<DeliveryProofProcessingResult>;
}

export type DeliveryProofReadResult =
  | Readonly<{ outcome: "SUCCESS"; bytes: Uint8Array }>
  | Readonly<{ outcome: "FAILURE"; code: "NOT_FOUND" | "UNAVAILABLE" }>;
/** Returns checksum-verified bytes of one rendition; callers authorize the exact proof first. */
export interface DeliveryProofReadPort {
  read(command: DeliveryProofReadCommand): Promise<DeliveryProofReadResult>;
}

/** Sanitizes a brand image, preserving alpha and aspect ratio outside database transactions. */
export interface StorefrontLogoProcessingPort {
  process(
    command: StorefrontLogoProcessingCommand,
  ): Promise<StorefrontLogoProcessingResult>;
}
