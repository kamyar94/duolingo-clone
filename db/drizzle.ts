import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

// Connection settings come from the standard PGHOST, PGUSER, PGPASSWORD and PGDATABASE
// environment variables (set in docker-compose.yml and db.env).
const pool = new Pool({ max: 10 });
const db = drizzle(pool, { schema });

export default db;
