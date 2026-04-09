import fs from "fs";
import path from "path";
import { query } from "./pool.js";

const MIGRATIONS_DIR = path.join(import.meta.dirname, "../../db/migrations");

interface Migration {
  name: string;
  content: string;
}

async function getMigrationFiles(): Promise<Migration[]> {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.log(`Migrations directory not found: ${MIGRATIONS_DIR}`);
    return [];
  }

  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  files.sort();

  return files.map((name) => ({
    name,
    content: fs.readFileSync(path.join(MIGRATIONS_DIR, name), "utf-8"),
  }));
}

async function runMigrations(): Promise<void> {
  const migrations = await getMigrationFiles();

  if (migrations.length === 0) {
    console.log("No migration files found.");
    return;
  }

  console.log(`Found ${migrations.length} migration(s)`);

  for (const migration of migrations) {
    try {
      console.log(`Running migration: ${migration.name}...`);
      await query(migration.content);
      console.log(`✓ ${migration.name} completed successfully`);
    } catch (error: any) {
      // Handle "already exists" errors gracefully
      if (
        error.message &&
        (error.message.includes("already exists") ||
          error.message.includes("duplicate"))
      ) {
        console.log(`⚠ ${migration.name} - already applied (skipping)`);
      } else {
        console.error(`✗ ${migration.name} failed:`, error.message);
        throw error;
      }
    }
  }

  console.log("All migrations completed!");
}

runMigrations().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
