import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;
const required = ['DB_USER', 'DB_HOST', 'DB_NAME', 'DB_PASSWORD', 'DB_PORT'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const client = new Client({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT),
});

const preflightSql = `
  SELECT
    c.id,
    c.organization_id AS conversation_organization_id,
    c.student_id,
    s.organization_id AS student_organization_id
  FROM ai_conversations c
  LEFT JOIN students_v2 s ON s.id = c.student_id
  WHERE s.id IS NULL
     OR c.organization_id IS DISTINCT FROM s.organization_id
`;

try {
  await client.connect();
  const result = await client.query(preflightSql);
  if (result.rows.length > 0) {
    console.error('AI conversation ownership preflight FAILED. Deployment must stop.');
    console.table(result.rows);
    console.error(
      'Remediation required: reconcile each conversation organization_id with its owning students_v2.organization_id. No rows were deleted or reassigned.',
    );
    process.exitCode = 1;
  } else {
    console.log('AI conversation ownership preflight passed.');
  }
} catch (error) {
  console.error('AI conversation ownership preflight could not run:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
