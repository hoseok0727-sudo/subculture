import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const { Pool } = pg;

const connectionString = process.env.DB_URL ?? "postgresql://postgres:postgres@localhost:5432/subculture";

export const pool = new Pool({ connectionString });

export async function closePool() {
  await pool.end();
}
