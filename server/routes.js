import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import { openDatabase, setSetting, getSetting, logAudit, ensureSubmission, passwordHash } from "./db.js";
import { createSession, requireAdmin, requireCandidate, verifyPassword, canAccessCandidate } from "./auth.js";
import { addSocket, broadcast } from "./realtime.js";
import { adminState, publicState, settingsPayload } from "./state.js";
import { config, paths, uploadPolicy } from "./config.js";
import { ensureDir, safeFileName } from "./fs-utils.js";
import { detectBuffer } from "./media.js";
import { acceptChunk, confirmSubmission, createUploadSession } from "./upload.js";
import { exportGlobalManifest } from "./exporter.js";

const fileAccessTokens = new Map();

export async function registerRoutes(app) {
  await app.register(websocket);
  await app.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024, files: 1 }
  });
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer", bodyLimit: uploadPolicy.chunkBytes + 1024 * 1024 },
    (_request, body, done) => done(null, body)
  );

  app.get("/ws", { websocket: true }, (socket) => {
    const ws = addSocket(socket);
    ws.send(JSON.stringify({ type: "connected", at: new Date().toISOString() }));
  });

  app.get("/api/health", async () => ({
    ok: true,
    service: "nsm-practical-submission",
    time: new Date().toISOString(),
    storage: { dataRoot: config.dataRoot, backupRoot: config.backupRoot }
  }));

  app.get("/api/public/state", async () => publicState());

  app.post("/api/auth/login", async (request, reply) => {
    const { password, role } = request.body || {};
    const normalizedRole = role === "readonly" ? "readonly" : "admin";
    if (!password || !verifyPassword(normalizedRole, password)) {
      reply.code(401);
      return { ok: false, error: "รหัสผ่านไม่ถูกต้อง" };
    }
    const session = createSession(normalizedRole);
    logAudit(normalizedRole, "login", { role: normalizedRole });
    return { ok: true, ...session };
  });

  app.get("/api/admin/state", async (request, reply) => {
    requireAdmin(request, reply, true);
    return adminState();
  });

  app.get("/api/admin/settings", async (request, reply) => {
    requireAdmin(request, reply, true);
    return settingsPayload();
  });

  app.post("/api/admin/settings", async (request, reply) => {
    requireAdmin(request, reply);
    const allowed = [
      "examTitle",
      "organization",
      "position",
      "location",
      "reportTime",
      "taskDescription",
      "instructions",
      "announcement",
      "publicUrl"
    ];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(request.body || {}, key)) {
        setSetting(key, String(request.body[key] ?? ""));
      }
    }
    if (request.body?.adminPassword) {
      setSetting("adminPasswordHash", passwordHash(request.body.adminPassword));
    }
    if (request.body?.readOnlyPassword) {
      setSetting("readOnlyPasswordHash", passwordHash(request.body.readOnlyPassword));
    }
    logAudit("admin", "settings_updated", {
      keys: Object.keys(request.body || {}).filter((key) => !key.toLowerCase().includes("password"))
    });
    broadcast();
    return { ok: true, settings: settingsPayload() };
  });

  app.post("/api/admin/wifi-qr", async (request, reply) => {
    requireAdmin(request, reply);
    const file = await request.file();
    if (!file) {
      reply.code(400);
      return { ok: false, error: "ไม่พบไฟล์ภาพ QR Wi-Fi" };
    }
    const buffer = await file.toBuffer();
    const detected = await detectBuffer(buffer);
    if (!uploadPolicy.allowedImageMimes.has(detected.mime)) {
      reply.code(400);
      return { ok: false, error: "กรุณาอัปโหลดรูปภาพ JPG/PNG/WebP/GIF เท่านั้น" };
    }
    await ensureDir(paths.uploadWorksAssetsDir);
    const target = path.join(paths.uploadWorksAssetsDir, `wifi-qr.${detected.ext || "png"}`);
    await fs.promises.writeFile(target, buffer);
    setSetting("wifiQrPath", target);
    logAudit("admin", "wifi_qr_uploaded", { fileName: safeFileName(file.filename), mime: detected.mime });
    broadcast();
    return { ok: true, url: "/files/wifi-qr" };
  });

  app.get("/files/wifi-qr", async (_request, reply) => {
    const qrPath = getSetting("wifiQrPath", "");
    if (!qrPath) {
      reply.code(404);
      return "No Wi-Fi QR uploaded";
    }
    return streamFile(reply, qrPath);
  });

  app.post("/api/admin/timer/start", async (request, reply) => {
    requireAdmin(request, reply);
    const seconds = Number(request.body?.durationSeconds || getSetting("durationSeconds", config.exam.durationSeconds));
    const now = new Date();
    const deadline = new Date(now.getTime() + seconds * 1000);
    openDatabase()
      .prepare(
        "UPDATE timer SET state='running', duration_seconds=?, start_at=?, deadline_at=?, extended_seconds=0, updated_at=? WHERE id=1"
      )
      .run(seconds, now.toISOString(), deadline.toISOString(), now.toISOString());
    logAudit("admin", "timer_started", { seconds, deadlineAt: deadline.toISOString() });
    broadcast();
    return { ok: true };
  });

  app.post("/api/admin/timer/extend", async (request, reply) => {
    requireAdmin(request, reply);
    const extraSeconds = Number(request.body?.seconds || 0);
    const reason = String(request.body?.reason || "").trim();
    if (!Number.isFinite(extraSeconds) || extraSeconds <= 0 || !reason) {
      reply.code(400);
      return { ok: false, error: "ต้องระบุเวลาและเหตุผลการขยายเวลา" };
    }
    const timer = openDatabase().prepare("SELECT * FROM timer WHERE id=1").get();
    const currentDeadline = timer.deadline_at ? Date.parse(timer.deadline_at) : Date.now();
    const nextDeadline = new Date(Math.max(Date.now(), currentDeadline) + extraSeconds * 1000);
    openDatabase()
      .prepare(
        "UPDATE timer SET state='running', deadline_at=?, extended_seconds=extended_seconds+?, updated_at=? WHERE id=1"
      )
      .run(nextDeadline.toISOString(), extraSeconds, new Date().toISOString());
    logAudit("admin", "timer_extended", { extraSeconds, reason, deadlineAt: nextDeadline.toISOString() });
    broadcast();
    return { ok: true };
  });

  app.post("/api/admin/timer/stop", async (request, reply) => {
    requireAdmin(request, reply);
    const reason = String(request.body?.reason || "").trim() || "manual stop";
    openDatabase()
      .prepare("UPDATE timer SET state='ended', deadline_at=?, updated_at=? WHERE id=1")
      .run(new Date().toISOString(), new Date().toISOString());
    logAudit("admin", "timer_stopped", { reason });
    broadcast();
    return { ok: true };
  });

  app.post("/api/admin/candidates/:id/unlock", async (request, reply) => {
    requireAdmin(request, reply);
    const candidateId = request.params.id;
    const reason = String(request.body?.reason || "").trim();
    if (!reason) {
      reply.code(400);
      return { ok: false, error: "ต้องระบุเหตุผลการ unlock" };
    }
    ensureSubmission(candidateId);
    openDatabase()
      .prepare(
        "UPDATE submissions SET status='admin_unlocked', active_upload_id=NULL, progress=0, error_message=NULL, updated_at=? WHERE candidate_id=?"
      )
      .run(new Date().toISOString(), candidateId);
    logAudit("admin", "candidate_unlocked", { candidateId, reason });
    broadcast();
    return { ok: true };
  });

  app.get("/api/admin/candidates/:id", async (request, reply) => {
    requireAdmin(request, reply, true);
    return candidatePayload(request.params.id, true);
  });

  app.post("/api/admin/export", async (request, reply) => {
    requireAdmin(request, reply);
    const result = await exportGlobalManifest();
    logAudit("admin", "manifest_exported", result);
    return { ok: true, ...result };
  });

  app.post("/api/candidates/lookup", async (request, reply) => {
    const identifier = normalizeIdentifier(request.body?.identifier || "");
    const db = openDatabase();
    const candidate = db
      .prepare("SELECT * FROM candidates WHERE applicant_no=? OR CAST(sequence_no AS TEXT)=?")
      .get(identifier, identifier);
    if (!candidate) {
      reply.code(404);
      return { ok: false, error: "ไม่พบลำดับหรือเลขประจำตัวผู้สมัคร" };
    }
    ensureSubmission(candidate.id);
    const session = createSession("candidate", candidate.id);
    logAudit(`candidate:${candidate.applicant_no}`, "candidate_lookup", { sequenceNo: candidate.sequence_no });
    return {
      ok: true,
      token: session.token,
      candidate: await candidatePayload(candidate.id, true)
    };
  });

  app.get("/api/candidates/:id", async (request, reply) => {
    requireCandidate(request, reply, request.params.id);
    return candidatePayload(request.params.id, true);
  });

  app.post("/api/candidates/:id/upload-sessions", async (request, reply) => {
    requireCandidate(request, reply, request.params.id);
    try {
      return { ok: true, ...(createUploadSession(request.params.id, request.body?.files || [])) };
    } catch (error) {
      reply.code(400);
      return { ok: false, error: error.message };
    }
  });

  app.post("/api/upload-chunks", async (request, reply) => {
    const candidateId = request.headers["x-candidate-id"];
    requireCandidate(request, reply, candidateId);
    try {
      const result = await acceptChunk({
        uploadId: String(request.headers["x-upload-id"] || ""),
        fileId: String(request.headers["x-file-id"] || ""),
        chunkIndex: Number(request.headers["x-chunk-index"]),
        body: request.body
      });
      return { ok: true, ...result };
    } catch (error) {
      reply.code(400);
      return { ok: false, error: error.message };
    }
  });

  app.post("/api/candidates/:id/confirm", async (request, reply) => {
    requireCandidate(request, reply, request.params.id);
    try {
      const submission = confirmSubmission(request.params.id);
      logAudit(`candidate:${request.params.id}`, "submission_confirmed", {
        confirmationCode: submission.confirmation_code
      });
      return { ok: true, submission };
    } catch (error) {
      reply.code(400);
      return { ok: false, error: error.message };
    }
  });

  app.post("/api/file-links/:fileId", async (request, reply) => {
    const db = openDatabase();
    const file = db.prepare("SELECT * FROM files WHERE id=?").get(request.params.fileId);
    if (!file || !canAccessCandidate(request, file.candidate_id)) {
      reply.code(404);
      return { ok: false, error: "ไม่พบไฟล์หรือไม่มีสิทธิ์เปิดไฟล์" };
    }
    const kind = request.body?.kind === "original" ? "original" : "preview";
    const filePath = kind === "original" ? file.original_path : file.preview_path || file.original_path;
    const token = crypto.randomBytes(24).toString("base64url");
    fileAccessTokens.set(token, {
      filePath,
      fileName: file.original_name,
      mime: kind === "preview" && file.detected_type?.startsWith("video/") ? "video/mp4" : file.detected_type,
      expiresAt: Date.now() + 30 * 60 * 1000
    });
    return { ok: true, url: `/files/access/${token}` };
  });

  app.get("/files/access/:token", async (request, reply) => {
    const item = fileAccessTokens.get(request.params.token);
    if (!item || item.expiresAt < Date.now()) {
      fileAccessTokens.delete(request.params.token);
      reply.code(404);
      return "File link expired";
    }
    return streamFile(reply.header("Content-Type", item.mime || "application/octet-stream"), item.filePath);
  });

  if (fs.existsSync(paths.clientDist)) {
    app.register(fastifyStatic, {
      root: paths.clientDist,
      prefix: "/",
      decorateReply: true
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/") || request.url.startsWith("/files/")) {
        reply.code(404).send({ ok: false, error: "Not found" });
        return;
      }
      reply.sendFile("index.html");
    });
  }
}

function streamFile(reply, filePath) {
  return reply.send(fs.createReadStream(filePath));
}

async function candidatePayload(candidateId, includeName) {
  const db = openDatabase();
  const candidate = db.prepare("SELECT * FROM candidates WHERE id=?").get(candidateId);
  const submission = db.prepare("SELECT * FROM submissions WHERE candidate_id=?").get(candidateId);
  const files = db
    .prepare(
      "SELECT id,category,original_name,detected_type,size,sha256,status,duration_seconds,warning,error_message FROM files WHERE candidate_id=? AND upload_id=COALESCE(?,'') ORDER BY file_index"
    )
    .all(candidateId, submission?.active_upload_id || "");
  return {
    id: candidate.id,
    sequenceNo: candidate.sequence_no,
    applicantNo: candidate.applicant_no,
    fullName: includeName ? candidate.full_name : undefined,
    submission: {
      status: submission?.status || "not_started",
      progress: submission?.progress || 0,
      confirmationCode: submission?.confirmation_code,
      startedAt: submission?.started_at,
      uploadCompletedAt: submission?.upload_completed_at,
      verifiedAt: submission?.verified_at,
      confirmedAt: submission?.confirmed_at,
      errorMessage: submission?.error_message,
      backupStatus: submission?.backup_status
    },
    files: files.map((file) => ({
      id: file.id,
      category: file.category,
      name: file.original_name,
      detectedType: file.detected_type,
      size: file.size,
      sha256: file.sha256,
      status: file.status,
      durationSeconds: file.duration_seconds,
      warning: file.warning,
      errorMessage: file.error_message
    }))
  };
}

function normalizeIdentifier(value) {
  const thaiDigits = "๐๑๒๓๔๕๖๗๘๙";
  return String(value)
    .trim()
    .replace(/[๐-๙]/g, (digit) => String(thaiDigits.indexOf(digit)))
    .replace(/[^\d]/g, "");
}
