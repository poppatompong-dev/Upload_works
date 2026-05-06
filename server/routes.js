import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import QRCode from "qrcode";
import { openDatabase, setSetting, getSetting, logAudit, ensureSubmission, passwordHash, listAuditLogs } from "./db.js";
import { createSession, requireAdmin, requireCandidate, verifyPassword, canAccessCandidate, getSession, readBearer } from "./auth.js";
import { addSocket, broadcast } from "./realtime.js";
import { adminState, healthPayload, publicState, settingsPayload, submitState } from "./state.js";
import { config, paths, uploadPolicy } from "./config.js";
import { ensureDir, safeFileName } from "./fs-utils.js";
import { detectBuffer } from "./media.js";
import { acceptChunk, confirmSubmission, confirmSubmissionByAdmin, createUploadSession } from "./upload.js";
import { exportGlobalManifest } from "./exporter.js";
import { clearTestData } from "./reset.js";

const fileAccessTokens = new Map();

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 10 * 60 * 1000;
const loginAttempts = new Map();

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

  app.addHook("onResponse", async (request, reply) => {
    if (!shouldLogRequest(request, reply)) return;
    const session = getSession(request);
    const candidateId = session?.candidate_id || request.params?.id || request.headers["x-candidate-id"] || null;
    const actor = session ? (session.role === "candidate" ? `candidate:${session.candidate_id}` : session.role) : "anonymous";
    logAudit(
      actor,
      "api_request",
      {
        route: request.routeOptions?.url || request.url,
        query: request.query || {},
        candidateId,
        elapsedMs: Math.round(reply.elapsedTime || 0)
      },
      requestAuditMetadata(request, reply, session, candidateId)
    );
  });

  app.get("/ws", { websocket: true }, (socket) => {
    const ws = addSocket(socket);
    ws.send(JSON.stringify({ type: "connected", at: new Date().toISOString() }));
  });

  app.get("/api/health", async () => ({
    ok: true,
    service: "nsm-practical-submission",
    time: new Date().toISOString(),
    storage: { dataRoot: config.dataRoot, backupRoot: config.backupRoot, videoArchiveRoot: config.videoArchiveRoot }
  }));

  app.get("/api/public/state", async () => publicState());
  app.get("/api/public/submit-state", async () => submitState());
  app.get("/api/public/qr", async (request, reply) => {
    const text = String(request.query?.text || "").trim();
    const size = Math.min(420, Math.max(120, Number(request.query?.size || 220)));
    if (!text || text.length > 1024) {
      reply.code(400);
      return { ok: false, error: "ข้อมูลสำหรับสร้าง QR ไม่ถูกต้อง" };
    }
    const buffer = await QRCode.toBuffer(text, { margin: 1, width: size, errorCorrectionLevel: "M" });
    reply.header("content-type", "image/png");
    return reply.send(buffer);
  });

  app.post("/api/auth/login", async (request, reply) => {
    const clientIp = request.ip;
    const { password, role } = request.body || {};
    const normalizedRole = role === "readonly" ? "readonly" : "admin";
    const rec = loginAttempts.get(clientIp);
    if (rec?.lockedUntil > Date.now()) {
      const secs = Math.ceil((rec.lockedUntil - Date.now()) / 1000);
      logAudit(
        "anonymous",
        "login_rate_limited",
        { role: normalizedRole, remainingSeconds: secs },
        requestAuditMetadata(request, reply, null, null, "warning")
      );
      reply.code(429);
      return { ok: false, error: `พยายาม login ผิดพลาดหลายครั้ง กรุณารอ ${Math.ceil(secs / 60)} นาที` };
    }
    if (!password || !verifyPassword(normalizedRole, password)) {
      const next = loginAttempts.get(clientIp) || { count: 0, lockedUntil: 0 };
      if (next.lockedUntil && next.lockedUntil < Date.now()) {
        next.count = 0;
        next.lockedUntil = 0;
      }
      next.count += 1;
      if (next.count >= LOGIN_MAX_ATTEMPTS) {
        next.lockedUntil = Date.now() + LOGIN_LOCKOUT_MS;
        next.count = 0;
      }
      loginAttempts.set(clientIp, next);
      logAudit(
        "anonymous",
        "login_failed",
        { role: normalizedRole, attempt: next.count || LOGIN_MAX_ATTEMPTS },
        requestAuditMetadata(request, reply, null, null, "warning")
      );
      reply.code(401);
      return { ok: false, error: "รหัสผ่านไม่ถูกต้อง" };
    }
    loginAttempts.delete(clientIp);
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

  app.get("/api/admin/health", async (request, reply) => {
    requireAdmin(request, reply, true);
    return healthPayload();
  });

  app.get("/api/admin/audit-logs", async (request, reply) => {
    requireAdmin(request, reply, true);
    const logs = listAuditLogs({
      q: stringQuery(request.query?.q),
      actor: stringQuery(request.query?.actor),
      action: stringQuery(request.query?.action),
      level: stringQuery(request.query?.level),
      candidateId: stringQuery(request.query?.candidateId),
      method: stringQuery(request.query?.method),
      statusCode: stringQuery(request.query?.statusCode),
      from: stringQuery(request.query?.from),
      to: stringQuery(request.query?.to),
      limit: Number(request.query?.limit || 100)
    });
    return { ok: true, logs };
  });

  app.post("/api/admin/settings", async (request, reply) => {
    requireAdmin(request, reply);
    const allowed = [
      "examTitle",
      "organization",
      "position",
      "location",
      "reportTime",
      "durationSeconds",
      "taskDescription",
      "instructions",
      "announcement",
      "publicUrl",
      "wifiSsid",
      "wifiPassword"
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
        "UPDATE submissions SET status='admin_unlocked', active_upload_id=NULL, progress=0, candidate_confirmed_at=NULL, admin_confirmed_at=NULL, confirmed_at=NULL, error_message=NULL, updated_at=? WHERE candidate_id=?"
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

  app.patch("/api/admin/candidates/:id", async (request, reply) => {
    requireAdmin(request, reply);
    const candidateId = request.params.id;
    const sequenceNo = Number(request.body?.sequenceNo);
    const applicantNo = String(request.body?.applicantNo || "").trim();
    const fullName = String(request.body?.fullName || "").trim();
    const note = String(request.body?.note || "").trim();
    if (!Number.isInteger(sequenceNo) || sequenceNo <= 0 || !/^\d+$/.test(applicantNo) || !fullName) {
      reply.code(400);
      return { ok: false, error: "กรุณาระบุลำดับ เลขประจำตัวสอบ และชื่อผู้สอบให้ถูกต้อง" };
    }
    const db = openDatabase();
    const existing = db.prepare("SELECT * FROM candidates WHERE id=?").get(candidateId);
    if (!existing) {
      reply.code(404);
      return { ok: false, error: "ไม่พบผู้เข้าสอบ" };
    }
    const duplicate = db
      .prepare("SELECT id FROM candidates WHERE id<>? AND (sequence_no=? OR applicant_no=?)")
      .get(candidateId, sequenceNo, applicantNo);
    if (duplicate) {
      reply.code(409);
      return { ok: false, error: "ลำดับหรือเลขประจำตัวสอบซ้ำกับผู้เข้าสอบคนอื่น" };
    }
    db.prepare(
      "UPDATE candidates SET sequence_no=?, applicant_no=?, full_name=?, note=?, updated_at=? WHERE id=?"
    ).run(sequenceNo, applicantNo, fullName, note, new Date().toISOString(), candidateId);
    ensureSubmission(candidateId);
    logAudit("admin", "candidate_updated", { candidateId, sequenceNo, applicantNo, fullName });
    broadcast();
    return { ok: true, candidate: await candidatePayload(candidateId, true) };
  });

  app.post("/api/admin/candidates/:id/confirm", async (request, reply) => {
    requireAdmin(request, reply);
    try {
      const submission = confirmSubmissionByAdmin(request.params.id);
      logAudit("admin", "submission_admin_confirmed", {
        candidateId: request.params.id,
        adminConfirmedAt: submission.admin_confirmed_at
      });
      return { ok: true, submission };
    } catch (error) {
      reply.code(400);
      return { ok: false, error: error.message };
    }
  });

  app.post("/api/admin/export", async (request, reply) => {
    requireAdmin(request, reply);
    const result = await exportGlobalManifest();
    logAudit("admin", "manifest_exported", result);
    return { ok: true, ...result };
  });

  app.post("/api/admin/reset-test-data", async (request, reply) => {
    requireAdmin(request, reply);
    const confirmText = String(request.body?.confirm || "").trim();
    if (confirmText !== "CLEAR TEST DATA") {
      reply.code(400);
      return { ok: false, error: "ต้องยืนยันด้วยข้อความ CLEAR TEST DATA" };
    }
    const result = await clearTestData({
      actor: "admin",
      includeExports: request.body?.includeExports === true,
      includeBackups: request.body?.includeBackups !== false,
      preserveSessionToken: readBearer(request)
    });
    broadcast();
    return result;
  });

  app.post("/api/candidates/lookup", async (request, reply) => {
    const identifier = normalizeIdentifier(request.body?.identifier || "");
    if (!/^\d+$/.test(identifier)) {
      reply.code(400);
      return { ok: false, error: "กรุณากรอกลำดับที่หรือเลขประจำตัวสอบ" };
    }
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
        confirmedAt: submission.confirmed_at
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
    const previewIsMp4 = kind === "preview" && path.extname(filePath || "").toLowerCase() === ".mp4";
    const token = crypto.randomBytes(24).toString("base64url");
    fileAccessTokens.set(token, {
      filePath,
      fileName: file.original_name,
      mime: previewIsMp4 ? "video/mp4" : file.detected_type,
      expiresAt: Date.now() + 30 * 60 * 1000
    });
    logAudit(sessionActor(request), "file_link_created", {
      candidateId: file.candidate_id,
      fileId: file.id,
      kind,
      fileName: file.original_name,
      mime: file.detected_type
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

function shouldLogRequest(request, reply) {
  if (!request.url.startsWith("/api/")) return false;
  if (request.url.startsWith("/api/health")) return false;
  if (request.url.startsWith("/api/admin/audit-logs")) return false;
  if (reply.statusCode >= 400) return true;
  if (request.method !== "GET") return true;
  return request.url.startsWith("/api/admin/candidates/") || request.url.startsWith("/api/file-links/");
}

function requestAuditMetadata(request, reply, session, candidateId, level) {
  return {
    level: level || (reply.statusCode >= 400 ? "warning" : "info"),
    actorRole: session?.role || null,
    candidateId: candidateId || null,
    requestId: request.id,
    requestMethod: request.method,
    requestPath: request.url.split("?")[0],
    statusCode: reply.statusCode,
    ip: request.ip,
    userAgent: request.headers["user-agent"] || ""
  };
}

function sessionActor(request) {
  const session = getSession(request);
  if (!session) return "anonymous";
  return session.role === "candidate" ? `candidate:${session.candidate_id}` : session.role;
}

function stringQuery(value) {
  if (Array.isArray(value)) return String(value[0] || "").trim();
  return String(value || "").trim();
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
      "SELECT id,category,original_name,detected_type,size,sha256,status,duration_seconds,video_width,video_height,aspect_ratio,warning,error_message FROM files WHERE candidate_id=? AND upload_id=COALESCE(?,'') ORDER BY file_index"
    )
    .all(candidateId, submission?.active_upload_id || "");
  return {
    id: candidate.id,
    sequenceNo: candidate.sequence_no,
    applicantNo: candidate.applicant_no,
    fullName: includeName ? candidate.full_name : undefined,
    note: includeName ? candidate.note : undefined,
    submission: {
      status: submission?.status || "not_started",
      progress: submission?.progress || 0,
      startedAt: submission?.started_at,
      uploadCompletedAt: submission?.upload_completed_at,
      verifiedAt: submission?.verified_at,
      confirmedAt: submission?.confirmed_at,
      candidateConfirmedAt: submission?.candidate_confirmed_at,
      adminConfirmedAt: submission?.admin_confirmed_at,
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
      videoWidth: file.video_width,
      videoHeight: file.video_height,
      aspectRatio: file.aspect_ratio,
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
