import fs from "node:fs";
import path from "node:path";
import { openDatabase } from "./db.js";
import { config, paths } from "./config.js";
import { ensureDir, copyFileSafe, safeFileName } from "./fs-utils.js";

export function candidateFolderName(candidate) {
  return `${String(candidate.sequence_no).padStart(2, "0")}_${candidate.applicant_no}_${safeFileName(candidate.full_name)}`;
}

export async function writeCandidateManifest(candidateId) {
  const db = openDatabase();
  const candidate = db.prepare("SELECT * FROM candidates WHERE id = ?").get(candidateId);
  if (!candidate) throw new Error("Candidate not found");
  const submission = db.prepare("SELECT * FROM submissions WHERE candidate_id = ?").get(candidateId);
  const files = db
    .prepare("SELECT * FROM files WHERE candidate_id = ? ORDER BY file_index")
    .all(candidateId);
  const manifest = {
    generatedAt: new Date().toISOString(),
    candidate: {
      sequenceNo: candidate.sequence_no,
      applicantNo: candidate.applicant_no,
      fullName: candidate.full_name
    },
    submission: submission ? withoutConfirmationCode(submission) : null,
    files: files.map((file) => ({
      id: file.id,
      category: file.category,
      originalName: file.original_name,
      detectedType: file.detected_type,
      size: file.size,
      sha256: file.sha256,
      durationSeconds: file.duration_seconds,
      videoWidth: file.video_width,
      videoHeight: file.video_height,
      aspectRatio: file.aspect_ratio,
      warning: file.warning,
      status: file.status
    }))
  };
  const dir = path.join(paths.submissionsDir, candidateFolderName(candidate));
  await ensureDir(dir);
  const manifestPath = path.join(dir, "manifest.json");
  await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return { manifest, manifestPath, folderName: candidateFolderName(candidate) };
}

function withoutConfirmationCode(row) {
  const { confirmation_code: _confirmationCode, ...rest } = row;
  return rest;
}

export async function backupCandidate(candidateId) {
  const db = openDatabase();
  const candidate = db.prepare("SELECT * FROM candidates WHERE id = ?").get(candidateId);
  if (!candidate) throw new Error("Candidate not found");
  const folderName = candidateFolderName(candidate);
  const sourceDir = path.join(paths.submissionsDir, folderName);
  const backupDir = path.join(paths.backupSubmissionsDir, folderName);
  await ensureDir(backupDir);
  await fs.promises.cp(sourceDir, backupDir, { recursive: true, force: true });
  db.prepare(
    "UPDATE submissions SET backup_status='copied', backup_error=NULL, updated_at=? WHERE candidate_id=?"
  ).run(new Date().toISOString(), candidateId);
}

export async function archiveCandidateVideos(candidateId) {
  const db = openDatabase();
  const candidate = db.prepare("SELECT * FROM candidates WHERE id = ?").get(candidateId);
  if (!candidate) throw new Error("Candidate not found");
  const folderName = candidateFolderName(candidate);
  const files = db
    .prepare(
      `SELECT * FROM files
       WHERE candidate_id = ?
         AND category = 'video'
         AND original_path IS NOT NULL
       ORDER BY file_index`
    )
    .all(candidateId);

  const archived = [];
  for (const file of files) {
    const originalName = path.basename(file.original_path);
    const originalTarget = path.join(paths.videoOriginalsDir, folderName, originalName);
    await copyFileSafe(file.original_path, originalTarget);

    let mp4Target = null;
    const previewPath = file.preview_path || "";
    if (previewPath && path.extname(previewPath).toLowerCase() === ".mp4") {
      const mp4Name = `${path.basename(originalName, path.extname(originalName))}.mp4`;
      mp4Target = path.join(paths.videoMp4Dir, folderName, mp4Name);
      await copyFileSafe(previewPath, mp4Target);
    }

    archived.push({
      fileId: file.id,
      original: originalTarget,
      mp4: mp4Target
    });
  }
  return { folderName, archived };
}

export async function archiveAllCandidateVideos() {
  const db = openDatabase();
  const candidates = db
    .prepare(
      `SELECT DISTINCT c.id
       FROM candidates c
       JOIN files f ON f.candidate_id = c.id
       WHERE f.category = 'video'
         AND f.original_path IS NOT NULL
       ORDER BY c.sequence_no`
    )
    .all();
  const results = [];
  for (const candidate of candidates) {
    results.push(await archiveCandidateVideos(candidate.id));
  }
  return {
    videoArchiveRoot: config.videoArchiveRoot,
    originalDir: paths.videoOriginalsDir,
    mp4Dir: paths.videoMp4Dir,
    candidates: results.length,
    files: results.reduce((sum, result) => sum + result.archived.length, 0),
    results
  };
}

export async function exportGlobalManifest() {
  const db = openDatabase();
  await ensureDir(paths.exportsDir);
  await ensureDir(paths.backupExportsDir);
  const candidates = db
    .prepare(
      `SELECT c.sequence_no, c.applicant_no, c.full_name,
              COALESCE(s.status,'not_started') AS status,
              s.confirmed_at, s.candidate_confirmed_at, s.admin_confirmed_at, s.verified_at,
              s.backup_status, s.error_message
       FROM candidates c
       LEFT JOIN submissions s ON s.candidate_id = c.id
       ORDER BY c.sequence_no`
    )
    .all();
  const files = db
    .prepare(
      `SELECT c.applicant_no, f.category, f.original_name, f.detected_type, f.size, f.sha256, f.status, f.warning, f.error_message
       FROM files f JOIN candidates c ON c.id = f.candidate_id
       ORDER BY c.sequence_no, f.file_index`
    )
    .all();
  const payload = {
    generatedAt: new Date().toISOString(),
    storage: {
      dataRoot: config.dataRoot,
      backupRoot: config.backupRoot,
      videoArchiveRoot: config.videoArchiveRoot
    },
    candidates,
    files
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(paths.exportsDir, `exam-manifest-${stamp}.json`);
  const csvPath = path.join(paths.exportsDir, `exam-summary-${stamp}.csv`);
  await fs.promises.writeFile(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  const csv = [
    "sequence_no,applicant_no,full_name,status,candidate_confirmed_at,admin_confirmed_at,confirmed_at,backup_status,error_message",
    ...candidates.map((row) =>
      [
        row.sequence_no,
        row.applicant_no,
        quoteCsv(row.full_name),
        row.status,
        row.candidate_confirmed_at || "",
        row.admin_confirmed_at || "",
        row.confirmed_at || "",
        row.backup_status || "",
        quoteCsv(row.error_message || "")
      ].join(",")
    )
  ].join("\r\n");
  await fs.promises.writeFile(csvPath, csv, "utf8");
  await copyFileSafe(jsonPath, path.join(paths.backupExportsDir, path.basename(jsonPath)));
  await copyFileSafe(csvPath, path.join(paths.backupExportsDir, path.basename(csvPath)));

  const auditRows = db
    .prepare(
      `SELECT id, created_at, level, actor, action, candidate_id,
              request_method, request_path, status_code, ip, detail_json
       FROM audit_logs ORDER BY id ASC`
    )
    .all();
  const auditCsvPath = path.join(paths.exportsDir, `audit-logs-${stamp}.csv`);
  const auditCsv = [
    "id,created_at,level,actor,action,candidate_id,request_method,request_path,status_code,ip,detail",
    ...auditRows.map((row) =>
      [
        row.id,
        row.created_at,
        row.level,
        quoteCsv(row.actor),
        quoteCsv(row.action),
        row.candidate_id || "",
        row.request_method || "",
        quoteCsv(row.request_path || ""),
        row.status_code || "",
        row.ip || "",
        quoteCsv(row.detail_json || "{}")
      ].join(",")
    )
  ].join("\r\n");
  await fs.promises.writeFile(auditCsvPath, auditCsv, "utf8");
  await copyFileSafe(auditCsvPath, path.join(paths.backupExportsDir, path.basename(auditCsvPath)));

  return { jsonPath, csvPath, auditCsvPath };
}

function quoteCsv(value) {
  const text = String(value ?? "");
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}
