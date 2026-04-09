import { Pool, QueryResult } from "pg";
import dotenv from "dotenv";

dotenv.config();

// Create pool from DATABASE_URL or individual connection parameters
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    `postgresql://${process.env.PG_USER || "ai_studio"}:${
      process.env.PG_PASSWORD || "ai_studio"
    }@${process.env.PG_HOST || "localhost"}:${
      process.env.PG_PORT || "5432"
    }/${process.env.PG_DATABASE || "ai_studio"}`,
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle client", err);
});

// Helper function to execute queries
export async function query<T = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  const client = await pool.connect();
  try {
    return await client.query<T>(text, params);
  } finally {
    client.release();
  }
}

// Helper to get a single row
export async function getOne<T = any>(
  text: string,
  params?: any[]
): Promise<T | null> {
  const result = await query<T>(text, params);
  return result.rows[0] || null;
}

// Helper to get all rows
export async function getAll<T = any>(
  text: string,
  params?: any[]
): Promise<T[]> {
  const result = await query<T>(text, params);
  return result.rows;
}

// Health check function
export async function healthCheck(): Promise<boolean> {
  try {
    const result = await query("SELECT NOW()");
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

export { pool };
