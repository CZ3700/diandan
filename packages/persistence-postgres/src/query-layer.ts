import {
  drizzle,
  type NodePgClient,
  type NodePgDatabase,
} from "drizzle-orm/node-postgres";

export type PostgresQueryLayer = NodePgDatabase;

export function createPostgresQueryLayer(
  client: NodePgClient,
): PostgresQueryLayer {
  return drizzle(client);
}
