export const workspacePackageName = "@fan-support/cache-purge-cdn" as const;

export {
  createCloudFrontCachePurgeAdapter,
  type CloudFrontCachePurgeAdapterConfig,
} from "./adapter.js";
