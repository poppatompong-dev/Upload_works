import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import { config, paths } from "./config.js";
import { ensureDirSync } from "./fs-utils.js";

let db;

export function passwordHash(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

export function openDatabase() {
  if (db) return db;
  ensureDirSync(paths.dbDir);
  db = new DatabaseSync(paths.dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  migrate(db);
  seedSettings(db);
  return db;
}

function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY,
      sequence_no INTEGER NOT NULL UNIQUE,
      applicant_no TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS submissions (
      candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'not_started',
      active_upload_id TEXT,
      progress REAL NOT NULL DEFAULT 0,
      started_at TEXT,
      upload_completed_at TEXT,
      verifying_at TEXT,
      verified_at TEXT,
      confirmed_at TEXT,
      confirmation_code TEXT,
      error_message TEXT,
      backup_status TEXT NOT NULL DEFAULT 'not_started',
      backup_error TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      upload_id TEXT NOT NULL,
      file_index INTEGER NOT NULL,
      category TEXT NOT NULL,
      original_name TEXT NOT NULL,
      declared_type TEXT,
      detected_type TEXT,
      size INTEGER NOT NULL DEFAULT 0,
      expected_size INTEGER NOT NULL,
      sha256 TEXT,
      original_path TEXT,
      preview_path TEXT,
      thumbnail_path TEXT,
      status TEXT NOT NULL DEFAULT 'uploading',
      total_chunks INTEGER NOT NULL,
      received_chunks INTEGER NOT NULL DEFAULT 0,
      duration_seconds REAL,
      warning TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS timer (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      state TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL,
      start_at TEXT,
      deadline_at TEXT,
      extended_seconds INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      detail_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      candidate_id TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  const now = new Date().toISOString();
  database
    .prepare(
      "INSERT OR IGNORE INTO timer (id,state,duration_seconds,updated_at) VALUES (1,'idle',?,?)"
    )
    .run(config.exam.durationSeconds, now);
}

function seedSettings(database) {
  const defaults = {
    examTitle: config.exam.title,
    organization: config.exam.organization,
    position: config.exam.position,
    location: config.exam.location,
    reportTime: config.exam.reportTime,
    durationSeconds: String(config.exam.durationSeconds),
    taskDescription: config.exam.taskDescription,
    instructions: config.exam.instructions,
    announcement: "โปรดส่งผลงาน เปิดดูตัวอย่าง และกดยืนยันก่อนหมดเวลา",
    adminPasswordHash: passwordHash(config.adminPassword),
    readOnlyPasswordHash: passwordHash(config.readOnlyPassword)
  };
  const stmt = database.prepare(
    "INSERT OR IGNORE INTO settings (key,value,updated_at) VALUES (?,?,?)"
  );
  const now = new Date().toISOString();
  for (const [key, value] of Object.entries(defaults)) {
    stmt.run(key, String(value), now);
  }
}

export function getSetting(key, fallback = "") {
  const row = openDatabase().prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  openDatabase()
    .prepare(
      "INSERT INTO settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at"
    )
    .run(key, String(value), new Date().toISOString());
}

export function logAudit(actor, action, detail = {}) {
  openDatabase()
    .prepare("INSERT INTO audit_logs (actor,action,detail_json,created_at) VALUES (?,?,?,?)")
    .run(actor, action, JSON.stringify(detail), new Date().toISOString());
}

export function ensureSubmission(candidateId) {
  openDatabase()
    .prepare(
      "INSERT OR IGNORE INTO submissions (candidate_id,status,updated_at) VALUES (?,'not_started',?)"
    )
    .run(candidateId, new Date().toISOString());
}

export function publicCandidateRows() {
  return openDatabase()
    .prepare(
      `SELECT c.id, c.sequence_no, c.applicant_no,
              COALESCE(s.status,'not_started') AS status,
              COALESCE(s.progress,0) AS progress,
              s.confirmation_code, s.confirmed_at, s.error_message
       FROM candidates c
       LEFT JOIN submissions s ON s.candidate_id = c.id
       ORDER BY c.sequence_no`
    )
    .all();
}

export function adminCandidateRows() {
  return openDatabase()
    .prepare(
      `SELECT c.id, c.sequence_no, c.applicant_no, c.full_name, c.note,
              COALESCE(s.status,'not_started') AS status,
              COALESCE(s.progress,0) AS progress,
              s.active_upload_id, s.started_at, s.upload_completed_at,
              s.verifying_at, s.verified_at, s.confirmed_at,
              s.confirmation_code, s.error_message, s.backup_status, s.backup_error
       FROM candidates c
       LEFT JOIN submissions s ON s.candidate_id = c.id
       ORDER BY c.sequence_no`
    )
    .all();
}

export function timerRow() {
  return openDatabase().prepare("SELECT * FROM timer WHERE id = 1").get();
}
