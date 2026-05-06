import fs from "node:fs";
import path from "node:path";
import { paths } from "./config.js";
import { assertInside, ensureDir } from "./fs-utils.js";
import { logAudit, openDatabase } from "./db.js";

const resettableDirs = [
  ["submissions", paths.submissionsDir],
  ["temp", paths.tempDir],
  ["videoOriginals", paths.videoOriginalsDir],
  ["videoMp4", paths.videoMp4Dir],
  ["backupSubmissions", paths.backupSubmissionsDir]
];

export async function clearTestData({
  actor = "admin",
  includeExports = false,
  includeBackups = true,
  preserveSessionToken = ""
} = {}) {
  const db = openDatabase();
  const before = {
    files: db.prepare("SELECT COUNT(*) AS count FROM files").get().count,
    submissions: db.prepare("SELECT COUNT(*) AS count FROM submissions WHERE status <> 'not_started' OR progress <> 0").get().count,
    sessions: db.prepare("SELECT COUNT(*) AS count FROM sessions").get().count,
    auditLogs: db.prepare("SELECT COUNT(*) AS count FROM audit_logs").get().count
  };

  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM files").run();
    db.prepare(
      `UPDATE submissions
       SET status='not_started',
           active_upload_id=NULL,
           progress=0,
           started_at=NULL,
           upload_completed_at=NULL,
           verifying_at=NULL,
           verified_at=NULL,
           confirmed_at=NULL,
           candidate_confirmed_at=NULL,
           admin_confirmed_at=NULL,
           confirmation_code=NULL,
           error_message=NULL,
           backup_status='not_started',
           backup_error=NULL,
           updated_at=?`
    ).run(now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const clearedDirs = [];
  for (const [name, dir] of resettableDirs) {
    if (!includeBackups && (name === "backupSubmissions" || name === "backupExports")) continue;
    await clearDirectory(dir);
    clearedDirs.push({ name, path: dir });
  }
  if (includeExports) {
    await clearDirectory(paths.exportsDir);
    clearedDirs.push({ name: "exports", path: paths.exportsDir });
  }

  logAudit(actor, "test_data_cleared", { before, clearedDirs });

  return {
    ok: true,
    before,
    clearedDirs,
    preserved: ["candidates", "settings", "sessions", "audit_logs", "timer", "exports", "Upload_Works/roster", "Upload_Works/assets"]
  };
}

async function clearDirectory(dir) {
  await ensureDir(dir);
  const parent = path.dirname(dir);
  assertInside(parent, dir);
  await fs.promises.rm(dir, { recursive: true, force: true });
  await ensureDir(dir);
}
