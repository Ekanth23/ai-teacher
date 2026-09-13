import fs from "fs";
import path from "path";
import pool from "../src/db.js";

(async () => {
  try {
    const migrationsPath = path.resolve(new URL('.', import.meta.url).pathname, "..", "migrations", "010_create_phase1_academic_foundation.sql");
    const sql = fs.readFileSync(migrationsPath, "utf8");
    console.log("Applying migration from:", migrationsPath);
    await pool.query(sql);
    console.log("Migration applied successfully.");
    process.exit(0);
  } catch (err) {
    console.error("Failed to apply migrations:", err);
    process.exit(1);
  }
})();
