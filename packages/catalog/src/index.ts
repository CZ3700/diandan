export const workspacePackageName = "@fan-support/catalog" as const;

export * from "./discovery.js";
export * from "./discovery-cache.js";
export {
  createIdolDirectoryCursor,
  decodeIdolDirectoryCursor,
  createIdolDirectoryQueryHash,
} from "./directory-cursor.js";
export { normalizeArtistSearchName } from "./discovery.js";
