import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { openDatabase, ensureSubmission, logAudit } from "./db.js";
import { paths } from "./config.js";
import { ensureDir, safeFileName, sha256File, assertInside } from "./fs-utils.js";
import {
  classifyAllowed,
  createVideoThumbnail,
  detectFile,
  probeVideo,
  transcodePreview
} from "./media.js";
import { backupCandidate, candidateFolderName, writeCandidateManifest } from "./exporter.js";
import { broadcast } from "./realtime.js";

export function isTimerOpen() {
  const timer = openDatabase().prepare("SELECT * FROM timer WHERE id = 1").get();
  if (!timer || timer.state !== "running" || !timer.deadline_at) return false;
  return Date.now() < Date.parse(timer.deadline_at);
}

export function createUploadSession(candidateId, files) {
  const db = openDatabase();
  if (!isTimerOpen()) throw new Error("ระบบยังไม่เปิดรับหรือหมดเวลาแล้ว");
  const candidate = db.prepare("SELECT * FROM candidates WHERE id = ?").get(candidateId);
  if (!candidate) throw new Error("ไม่พบผู้เข้าสอบ");
  ensureSubmission(candidateId);
  const current = db.prepare("SELECT * FROM submissions WHERE candidate_id = ?").get(candidateId);
  if (current?.candidate_confirmed_at) throw new Error("ยืนยันการส่งงานแล้ว ไม่สามารถส่งซ้ำได้");
  if (current?.active_upload_id) {
    cleanupUploadTempSync(current.active_upload_id);
  }
  if (!Array.isArray(files) || files.length === 0) throw new Error("กรุณาเลือกไฟล์อย่างน้อย 1 ไฟล์");
  if (!files.some((file) => file.category === "video")) {
    throw new Error("ต้องมีไฟล์วิดีโออย่างน้อย 1 ไฟล์");
  }

  const uploadId = crypto.randomUUID();
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    db.prepare(
      `UPDATE submissions
       SET status='uploading', active_upload_id=?, progress=0, started_at=COALESCE(started_at,?),
           candidate_confirmed_at=NULL, admin_confirmed_at=NULL, confirmed_at=NULL,
           error_message=NULL, updated_at=?
       WHERE candidate_id=?`
    ).run(uploadId, now, now, candidateId);
    const stmt = db.prepare(
      `INSERT INTO files
       (id,candidate_id,upload_id,file_index,category,original_name,declared_type,expected_size,total_chunks,status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,'uploading',?,?)`
    );
    files.forEach((file, index) => {
      const totalChunks = Number(file.totalChunks || 0);
      const size = Number(file.size || 0);
      if (!Number.isFinite(size) || size <= 0) throw new Error("ขนาดไฟล์ไม่ถูกต้อง");
      if (!Number.isInteger(totalChunks) || totalChunks <= 0) throw new Error("จำนวน chunk ไม่ถูกต้อง");
      stmt.run(
        crypto.randomUUID(),
        candidateId,
        uploadId,
        index,
        file.category,
        safeFileName(file.name),
        file.type || "",
        size,
        totalChunks,
        now,
        now
      );
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  logAudit(`candidate:${candidate.applicant_no}`, "upload_session_created", {
    candidateId,
    uploadId,
    fileCount: files.length
  });
  broadcast();
  return {
    uploadId,
    files: db
      .prepare("SELECT id, file_index, original_name, total_chunks FROM files WHERE upload_id=?")
      .all(uploadId)
      .map((row) => ({
        id: row.id,
        fileIndex: row.file_index,
        name: row.original_name,
        totalChunks: row.total_chunks
      }))
  };
}

export async function acceptChunk({ uploadId, fileId, chunkIndex, body }) {
  if (!isTimerOpen()) throw new Error("หมดเวลาส่งงานแล้ว ระบบไม่รับข้อมูลเพิ่มเติม");
  const db = openDatabase();
  const file = db.prepare("SELECT * FROM files WHERE id=? AND upload_id=?").get(fileId, uploadId);
  if (!file) throw new Error("ไม่พบไฟล์ใน upload session");
  if (file.status !== "uploading") return { done: true };
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= file.total_chunks) {
    throw new Error("chunk index ไม่ถูกต้อง");
  }
  const chunkDir = path.join(paths.tempDir, uploadId, fileId);
  assertInside(paths.tempDir, chunkDir);
  await ensureDir(chunkDir);
  const chunkPath = path.join(chunkDir, `${String(chunkIndex).padStart(6, "0")}.part`);
  await fs.promises.writeFile(chunkPath, body);
  const chunkCount = (await fs.promises.readdir(chunkDir)).filter((name) => name.endsWith(".part")).length;
  const progress = Math.min(99, Math.round((chunkCount / file.total_chunks) * 100));
  db.prepare("UPDATE files SET received_chunks=?, updated_at=? WHERE id=?").run(
    chunkCount,
    new Date().toISOString(),
    fileId
  );
  updateSubmissionProgress(file.candidate_id, uploadId);
  if (chunkCount === file.total_chunks) {
    await assembleFile(fileId);
    await maybeVerifyUpload(file.candidate_id, uploadId);
  } else {
    broadcast();
  }
  return { receivedChunks: chunkCount, totalChunks: file.total_chunks, progress };
}

function updateSubmissionProgress(candidateId, uploadId) {
  const db = openDatabase();
  const rows = db
    .prepare("SELECT received_chunks,total_chunks FROM files WHERE candidate_id=? AND upload_id=?")
    .all(candidateId, uploadId);
  const total = rows.reduce((sum, row) => sum + row.total_chunks, 0);
  const received = rows.reduce((sum, row) => sum + row.received_chunks, 0);
  const progress = total > 0 ? Math.min(99, Math.round((received / total) * 100)) : 0;
  db.prepare("UPDATE submissions SET progress=?, updated_at=? WHERE candidate_id=?").run(
    progress,
    new Date().toISOString(),
    candidateId
  );
}

async function assembleFile(fileId) {
  const db = openDatabase();
  const file = db.prepare("SELECT * FROM files WHERE id=?").get(fileId);
  const candidate = db.prepare("SELECT * FROM candidates WHERE id=?").get(file.candidate_id);
  const folder = path.join(paths.submissionsDir, candidateFolderName(candidate), "original");
  await ensureDir(folder);
  const ext = path.extname(file.original_name);
  const base = safeFileName(path.basename(file.original_name, ext));
  const outputPath = path.join(
    folder,
    `${String(file.file_index + 1).padStart(2, "0")}_${base}_${file.id.slice(0, 8)}${ext || ".bin"}`
  );
  assertInside(paths.submissionsDir, outputPath);
  const chunkDir = path.join(paths.tempDir, file.upload_id, file.id);
  const chunks = (await fs.promises.readdir(chunkDir))
    .filter((name) => name.endsWith(".part"))
    .sort();
  const out = fs.createWriteStream(outputPath, { flags: "w" });
  for (const chunkName of chunks) {
    await new Promise((resolve, reject) => {
      const input = fs.createReadStream(path.join(chunkDir, chunkName));
      input.on("error", reject);
      input.on("end", resolve);
      input.pipe(out, { end: false });
    });
  }
  await new Promise((resolve) => out.end(resolve));
  const stat = await fs.promises.stat(outputPath);
  if (stat.size !== file.expected_size) {
    throw new Error(`ขนาดไฟล์ไม่ตรง expected ${file.expected_size} bytes แต่ได้รับ ${stat.size} bytes`);
  }
  db.prepare("UPDATE files SET original_path=?, size=?, status='uploaded', updated_at=? WHERE id=?").run(
    outputPath,
    stat.size,
    new Date().toISOString(),
    fileId
  );
  await fs.promises.rm(chunkDir, { recursive: true, force: true });
  await cleanupEmptyUploadTemp(file.upload_id);
  logAudit(`candidate:${candidate.applicant_no}`, "file_uploaded", {
    candidateId: file.candidate_id,
    uploadId: file.upload_id,
    fileId,
    fileName: file.original_name,
    size: stat.size,
    path: outputPath
  });
}

function cleanupUploadTempSync(uploadId) {
  const uploadDir = path.join(paths.tempDir, uploadId);
  assertInside(paths.tempDir, uploadDir);
  fs.rmSync(uploadDir, { recursive: true, force: true });
}

async function cleanupEmptyUploadTemp(uploadId) {
  const uploadDir = path.join(paths.tempDir, uploadId);
  assertInside(paths.tempDir, uploadDir);
  try {
    const remaining = await fs.promises.readdir(uploadDir);
    if (remaining.length === 0) {
      await fs.promises.rm(uploadDir, { recursive: true, force: true });
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function maybeVerifyUpload(candidateId, uploadId) {
  const db = openDatabase();
  const remaining = db
    .prepare("SELECT COUNT(*) AS count FROM files WHERE candidate_id=? AND upload_id=? AND status='uploading'")
    .get(candidateId, uploadId).count;
  if (remaining > 0) return;
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE submissions SET status='verifying', progress=100, upload_completed_at=?, verifying_at=?, updated_at=? WHERE candidate_id=?"
  ).run(now, now, now, candidateId);
  broadcast();
  verifySubmission(candidateId, uploadId).catch((error) => {
    markSubmissionError(candidateId, error);
  });
}

async function verifySubmission(candidateId, uploadId) {
  const db = openDatabase();
  const files = db
    .prepare("SELECT * FROM files WHERE candidate_id=? AND upload_id=? ORDER BY file_index")
    .all(candidateId, uploadId);
  let hasVideo = false;
  for (const file of files) {
    const detected = await detectFile(file.original_path);
    const actualCategory = classifyAllowed(detected.mime, file.original_name);
    if (actualCategory === "unsupported") {
      throw new Error(`ไฟล์ ${file.original_name} ไม่ใช่วิดีโอ รูปภาพ หรือ PDF ที่ระบบรองรับ`);
    }
    if (file.category === "video" && actualCategory !== "video") {
      throw new Error(`ไฟล์ ${file.original_name} ถูกระบุเป็นวิดีโอ แต่ชนิดจริงคือ ${detected.mime}`);
    }
    hasVideo = hasVideo || actualCategory === "video";
    const sha256 = await sha256File(file.original_path);
    let previewPath = file.original_path;
    let thumbnailPath = null;
    let duration = null;
    let videoWidth = null;
    let videoHeight = null;
    let aspectRatio = null;
    let warning = null;
    if (actualCategory === "video") {
      const probe = await probeVideo(file.original_path);
      duration = probe.durationSeconds;
      videoWidth = probe.width;
      videoHeight = probe.height;
      aspectRatio = probe.aspectRatio;
      if (duration && duration > 65) warning = "วิดีโอมีความยาวเกิน 1 นาที โปรดให้กรรมการตรวจตามเกณฑ์สอบ";
      const previewDir = path.join(path.dirname(path.dirname(file.original_path)), "preview");
      previewPath = path.join(previewDir, `${file.id}.mp4`);
      thumbnailPath = path.join(previewDir, `${file.id}.jpg`);
      try {
        await transcodePreview(file.original_path, previewPath);
        await createVideoThumbnail(previewPath, thumbnailPath);
      } catch (error) {
        previewPath = file.original_path;
        thumbnailPath = null;
        warning = [warning, `รับไฟล์วิดีโอแล้ว แต่สร้าง preview MP4 ไม่สำเร็จ: ${error.message}`]
          .filter(Boolean)
          .join(" | ");
      }
    }
    db.prepare(
      `UPDATE files
       SET detected_type=?, sha256=?, preview_path=?, thumbnail_path=?, status='verified',
           duration_seconds=?, video_width=?, video_height=?, aspect_ratio=?, warning=?, updated_at=?
       WHERE id=?`
    ).run(
      detected.mime,
      sha256,
      previewPath,
      thumbnailPath,
      duration,
      videoWidth,
      videoHeight,
      aspectRatio,
      warning,
      new Date().toISOString(),
      file.id
    );
  }
  if (!hasVideo) throw new Error("ต้องมีไฟล์วิดีโออย่างน้อย 1 ไฟล์");
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE submissions
     SET status='ready_to_confirm', progress=100, verified_at=?, confirmation_code=NULL, error_message=NULL, updated_at=?
     WHERE candidate_id=?`
  ).run(now, now, candidateId);
  await writeCandidateManifest(candidateId);
  try {
    await backupCandidate(candidateId);
  } catch (error) {
    db.prepare(
      "UPDATE submissions SET backup_status='failed', backup_error=?, updated_at=? WHERE candidate_id=?"
    ).run(error.message, new Date().toISOString(), candidateId);
    logAudit(`candidate:${candidateId}`, "backup_failed", { candidateId, uploadId, error: error.message }, { level: "warning" });
  }
  logAudit(`candidate:${candidateId}`, "submission_verified", {
    candidateId,
    uploadId,
    fileCount: files.length
  });
  broadcast();
}

function markSubmissionError(candidateId, error) {
  const db = openDatabase();
  db.prepare(
    "UPDATE submissions SET status='needs_resubmit', error_message=?, updated_at=? WHERE candidate_id=?"
  ).run(error.message, new Date().toISOString(), candidateId);
  logAudit(`candidate:${candidateId}`, "verification_failed", { error: error.message });
  broadcast();
}

export function confirmSubmission(candidateId) {
  const db = openDatabase();
  const sub = db.prepare("SELECT * FROM submissions WHERE candidate_id=?").get(candidateId);
  if (!sub || !["ready_to_confirm", "admin_confirmed", "candidate_confirmed"].includes(sub.status)) {
    throw new Error("ยังไม่พร้อมยืนยัน กรุณารอระบบตรวจไฟล์ให้เสร็จ");
  }
  const now = new Date().toISOString();
  const candidateConfirmedAt = sub.candidate_confirmed_at || now;
  const adminConfirmedAt = sub.admin_confirmed_at || null;
  const nextStatus = adminConfirmedAt ? "confirmed" : "candidate_confirmed";
  const confirmedAt = adminConfirmedAt ? now : sub.confirmed_at;
  db.prepare(
    `UPDATE submissions
     SET status=?, candidate_confirmed_at=?, confirmed_at=?, updated_at=?
     WHERE candidate_id=?`
  ).run(nextStatus, candidateConfirmedAt, confirmedAt, now, candidateId);
  writeCandidateManifest(candidateId)
    .then(() => backupCandidate(candidateId))
    .catch((error) => {
      db.prepare(
        "UPDATE submissions SET backup_status='failed', backup_error=?, updated_at=? WHERE candidate_id=?"
      ).run(error.message, new Date().toISOString(), candidateId);
    })
    .finally(() => broadcast());
  broadcast();
  return db.prepare("SELECT * FROM submissions WHERE candidate_id=?").get(candidateId);
}

export async function cleanupStaleTemp() {
  const db = openDatabase();
  let entries;
  try {
    entries = await fs.promises.readdir(paths.tempDir);
  } catch {
    return;
  }
  for (const uploadId of entries) {
    const active = db
      .prepare("SELECT COUNT(*) AS count FROM files WHERE upload_id=? AND status='uploading'")
      .get(uploadId);
    if (!active || active.count === 0) {
      await fs.promises.rm(path.join(paths.tempDir, uploadId), { recursive: true, force: true }).catch(() => {});
    }
  }
}

export function confirmSubmissionByAdmin(candidateId) {
  const db = openDatabase();
  const sub = db.prepare("SELECT * FROM submissions WHERE candidate_id=?").get(candidateId);
  if (!sub || !["ready_to_confirm", "admin_confirmed", "candidate_confirmed"].includes(sub.status)) {
    throw new Error("ยังไม่พร้อมรับรอง กรุณารอระบบตรวจไฟล์ให้เสร็จ");
  }
  const now = new Date().toISOString();
  const adminConfirmedAt = sub.admin_confirmed_at || now;
  const candidateConfirmedAt = sub.candidate_confirmed_at || null;
  const nextStatus = candidateConfirmedAt ? "confirmed" : "admin_confirmed";
  const confirmedAt = candidateConfirmedAt ? now : sub.confirmed_at;
  db.prepare(
    `UPDATE submissions
     SET status=?, admin_confirmed_at=?, confirmed_at=?, updated_at=?
     WHERE candidate_id=?`
  ).run(nextStatus, adminConfirmedAt, confirmedAt, now, candidateId);
  writeCandidateManifest(candidateId)
    .then(() => backupCandidate(candidateId))
    .catch((error) => {
      db.prepare(
        "UPDATE submissions SET backup_status='failed', backup_error=?, updated_at=? WHERE candidate_id=?"
      ).run(error.message, new Date().toISOString(), candidateId);
    })
    .finally(() => broadcast());
  broadcast();
  return db.prepare("SELECT * FROM submissions WHERE candidate_id=?").get(candidateId);
}
