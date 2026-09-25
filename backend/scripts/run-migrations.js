import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const requiredEnv = ['DB_USER', 'DB_HOST', 'DB_NAME', 'DB_PASSWORD', 'DB_PORT'];
const missingEnv = requiredEnv.filter((name) => !process.env[name]);

if (missingEnv.length > 0) {
  console.error(`Missing required environment variables: ${missingEnv.join(', ')}`);
  process.exit(1);
}

const { Client } = pg;
const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url));

const client = new Client({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT),
});

async function ensureMigrationTable() {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function assertAiConversationOwnershipPreflight() {
  const result = await client.query(`
    SELECT
      c.id,
      c.organization_id AS conversation_organization_id,
      c.student_id,
      s.organization_id AS student_organization_id
    FROM ai_conversations c
    LEFT JOIN students_v2 s ON s.id = c.student_id
    WHERE s.id IS NULL
       OR c.organization_id IS DISTINCT FROM s.organization_id
  `);

  if (result.rows.length > 0) {
    const remediation =
      'AI conversation ownership preflight failed. Stop deployment and reconcile each conversation organization_id with its owning students_v2.organization_id. No rows were deleted or reassigned.';
    console.error(remediation);
    console.table(result.rows);
    throw new Error(remediation);
  }
}

async function run() {
  await client.connect();

  try {
    await ensureMigrationTable();

    const migrationFiles = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
      .map((entry) => entry.name)
      .sort();

    for (const fileName of migrationFiles) {
      if (fileName === '046_create_ai_conversation_foundation.sql') {
        await assertAiConversationOwnershipPreflight();
      }
      const version = fileName.replace(/\.sql$/, '');
      const existing = await client.query(
        'SELECT 1 FROM schema_migrations WHERE version = $1',
        [version]
      );

      if (existing.rowCount > 0) {
        continue;
      }

      const sql = readFileSync(join(migrationsDir, fileName), 'utf8');

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version, applied_at) VALUES ($1, NOW())', [version]);
        await client.query('COMMIT');
        console.log(`Applied migration: ${version}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    console.log('All migrations applied successfully.');
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
