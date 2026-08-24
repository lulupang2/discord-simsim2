import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema.js";

export type Database = NeonHttpDatabase<typeof schema>;

export interface DatabaseConnection {
  readonly db: Database;
  ping(): Promise<void>;
}

export function createDatabaseConnection(databaseUrl: string): DatabaseConnection {
  const client = neon(databaseUrl);
  const db = drizzle(client, { schema });

  return {
    db,
    async ping(): Promise<void> {
      await client`select 1`;
    },
  };
}
