import {
  createDeliveryProofProcessor,
  createDeliveryProofReader,
  createMediaSourceInspector,
  createMediaImageProcessor,
} from "@fan-support/media-image";
import { createS3MediaStorageAdapter } from "@fan-support/media-s3";

/** Both applications consume the same S3 buckets and immutable media identities. */
export function createLocalExperienceMedia({ config, s3 }) {
  if (config.environment !== "LOCAL_TEST")
    throw new TypeError("Media requires LOCAL_TEST");
  const storage = createS3MediaStorageAdapter({
    schemaVersion: 1,
    sourceBucket: s3.sourceBucket,
    derivativeBucket: s3.derivativeBucket,
    publicMediaOrigin: config.origins.media,
    maxUploadBytes: 33554432,
    region: "us-east-1",
    authentication: {
      mode: "static",
      endpoint: s3.endpoint,
      presignEndpoint: s3.endpoint,
      accessKeyId: s3.accessKeyId,
      secretAccessKey: s3.secretAccessKey,
      forcePathStyle: true,
    },
  });
  return {
    storage,
    inspector: createMediaSourceInspector({ storage, now: () => new Date() }),
    processor: createMediaImageProcessor({ storage, now: () => new Date() }),
    // Private delivery photos stay in the SOURCE bucket (V2 §4-6).
    proofProcessor: createDeliveryProofProcessor({
      storage,
      now: () => new Date(),
    }),
    proofReader: createDeliveryProofReader({ storage, now: () => new Date() }),
  };
}
