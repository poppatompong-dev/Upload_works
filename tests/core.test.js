import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";

const rootBase = path.join(process.cwd(), "runtime", "tests");
fs.mkdirSync(rootBase, { recursive: true });
const root = fs.mkdtempSync(path.join(rootBase, "nsm-exam-test-"));
process.env.EXAM_DATA_ROOT = path.join(root, "data");
process.env.EXAM_BACKUP_ROOT = path.join(root, "backup");
process.env.EXAM_VIDEO_ARCHIVE_ROOT = path.join(root, "video_archive");
process.env.UPLOAD_WORKS_DIR = path.join(root, "upload_works");
process.env.PUBLIC_URL = "http://127.0.0.1:8080";

const { openDatabase, ensureSubmission, getSetting, setSetting, logAudit, listAuditLogs } = await import("../server/db.js");
const { paths } = await import("../server/config.js");
const { localLanUrl, preferredLanAddress, publicState } = await import("../server/state.js");
const { createUploadSession } = await import("../server/upload.js");
const { exportGlobalManifest } = await import("../server/exporter.js");
const { classifyAllowed, videoDisplayMetadata } = await import("../server/media.js");
const { clearTestData } = await import("../server/reset.js");
const { registerRoutes } = await import("../server/routes.js");

test("database initializes exam defaults and timer", () => {
  const db = openDatabase();
  const timer = db.prepare("SELECT * FROM timer WHERE id=1").get();
  assert.equal(timer.state, "idle");
  assert.equal(getSetting("position"), "ผู้ช่วยนักประชาสัมพันธ์");
});

test("public state masks candidate names", async () => {
  const db = openDatabase();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT OR IGNORE INTO candidates (id,sequence_no,applicant_no,full_name,note,created_at,updated_at) VALUES ('cand-test',1,'07101001','ทดสอบ ระบบ','',?,?)"
  ).run(now, now);
  ensureSubmission("cand-test");
  const state = await publicState();
  assert.equal(state.candidates.length, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(state.candidates[0], "fullName"), false);
  assert.match(state.systemUrlQr, /^data:image\/png;base64,/);
});

test("submit QR state omits roster while verified candidate session shows full name", async () => {
  const db = openDatabase();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT OR IGNORE INTO candidates (id,sequence_no,applicant_no,full_name,note,created_at,updated_at) VALUES ('cand-submit-safe',99,'09999999','Hidden Name','',?,?)"
  ).run(now, now);
  ensureSubmission("cand-submit-safe");

  const app = Fastify({ logger: false });
  await registerRoutes(app);

  const state = await app.inject({ method: "GET", url: "/api/public/submit-state" });
  assert.equal(state.statusCode, 200);
  const submitState = JSON.parse(state.body);
  assert.equal(Object.prototype.hasOwnProperty.call(submitState, "candidates"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(submitState, "stats"), false);

  const invalidLookup = await app.inject({
    method: "POST",
    url: "/api/candidates/lookup",
    payload: { identifier: "" }
  });
  assert.equal(invalidLookup.statusCode, 400);

  const lookup = await app.inject({
    method: "POST",
    url: "/api/candidates/lookup",
    payload: { identifier: "99" }
  });
  assert.equal(lookup.statusCode, 200);
  const body = JSON.parse(lookup.body);
  assert.equal(body.candidate.fullName, "Hidden Name");
  assert.equal(body.candidate.sequenceNo, 99);
  assert.equal(body.candidate.applicantNo, "09999999");

  const detail = await app.inject({
    method: "GET",
    url: `/api/candidates/${body.candidate.id}`,
    headers: { authorization: `Bearer ${body.token}` }
  });
  assert.equal(detail.statusCode, 200);
  assert.equal(JSON.parse(detail.body).fullName, "Hidden Name");

  const adminLogin = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { role: "admin", password: "admin2569" }
  });
  assert.equal(adminLogin.statusCode, 200);
  const adminToken = JSON.parse(adminLogin.body).token;
  const start = await app.inject({
    method: "POST",
    url: "/api/admin/timer/start",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { durationSeconds: 900 }
  });
  assert.equal(start.statusCode, 200);
  const runningState = await app.inject({ method: "GET", url: "/api/public/submit-state" });
  assert.equal(runningState.statusCode, 200);
  const runningSubmitState = JSON.parse(runningState.body);
  assert.equal(runningSubmitState.timer.state, "running");
  assert.equal(runningSubmitState.timer.remainingSeconds > 0, true);
  const stop = await app.inject({
    method: "POST",
    url: "/api/admin/timer/stop",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { reason: "test cleanup" }
  });
  assert.equal(stop.statusCode, 200);

  await app.close();
});

test("LAN URL selection prefers reachable physical adapters over virtual ones", () => {
  const address = preferredLanAddress({
    "vEthernet (WSL (Hyper-V firewall))": [
      { family: "IPv4", internal: false, address: "172.30.80.1" }
    ],
    "Wi-Fi": [{ family: "IPv4", internal: false, address: "192.168.8.57" }],
    "Ethernet": [{ family: "IPv4", internal: false, address: "192.168.8.43" }]
  });
  assert.equal(address, "192.168.8.57");
});

test("submission QR URL always resolves to the private submit flow", () => {
  const previous = process.env.PUBLIC_URL;
  process.env.PUBLIC_URL = "http://127.0.0.1:8080/projector#status";
  try {
    assert.equal(localLanUrl(), "http://127.0.0.1:8080/submit");
  } finally {
    process.env.PUBLIC_URL = previous;
  }
});

test("upload session is rejected when timer is not running", () => {
  assert.throws(
    () =>
      createUploadSession("cand-test", [
        { name: "clip.mp4", size: 100, type: "video/mp4", category: "video", totalChunks: 1 }
      ]),
    /ยังไม่เปิดรับ|หมดเวลา/
  );
});

test("settings update and export manifest work", async () => {
  setSetting("announcement", "ทดสอบประกาศ");
  assert.equal(getSetting("announcement"), "ทดสอบประกาศ");
  const result = await exportGlobalManifest();
  assert.ok(fs.existsSync(result.jsonPath));
  assert.ok(fs.existsSync(result.csvPath));
});

test("reset utility clears upload data and folders while preserving roster and settings", async () => {
  const db = openDatabase();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT OR IGNORE INTO candidates (id,sequence_no,applicant_no,full_name,note,created_at,updated_at) VALUES ('cand-reset',2,'07101002','Reset Tester','',?,?)"
  ).run(now, now);
  ensureSubmission("cand-reset");
  db.prepare("UPDATE submissions SET status='ready_to_confirm', progress=100, active_upload_id='upload-reset', updated_at=? WHERE candidate_id='cand-reset'").run(now);
  db.prepare(
    `INSERT INTO files
     (id,candidate_id,upload_id,file_index,category,original_name,declared_type,detected_type,size,expected_size,status,total_chunks,received_chunks,created_at,updated_at)
     VALUES ('file-reset','cand-reset','upload-reset',0,'video','reset.mp4','video/mp4','video/mp4',10,10,'verified',1,1,?,?)`
  ).run(now, now);
  const tempFile = path.join(paths.tempDir, "upload-reset", "file-reset", "000000.part");
  const submissionFile = path.join(paths.submissionsDir, "reset.txt");
  const videoOriginalFile = path.join(paths.videoOriginalsDir, "reset.mp4");
  const videoMp4File = path.join(paths.videoMp4Dir, "reset.mp4");
  const exportFile = path.join(paths.exportsDir, "manifest.csv");
  fs.mkdirSync(path.dirname(tempFile), { recursive: true });
  fs.mkdirSync(paths.submissionsDir, { recursive: true });
  fs.mkdirSync(paths.videoOriginalsDir, { recursive: true });
  fs.mkdirSync(paths.videoMp4Dir, { recursive: true });
  fs.mkdirSync(paths.exportsDir, { recursive: true });
  fs.writeFileSync(tempFile, "chunk");
  fs.writeFileSync(submissionFile, "submission");
  fs.writeFileSync(videoOriginalFile, "original");
  fs.writeFileSync(videoMp4File, "mp4");
  fs.writeFileSync(exportFile, "export");
  db.prepare("UPDATE timer SET state='running', start_at=?, deadline_at=?, updated_at=? WHERE id=1").run(now, now, now);
  logAudit("test", "preserve_audit_log", { keep: true });

  const result = await clearTestData({ actor: "test" });
  assert.equal(result.ok, true);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM candidates").get().count >= 1, true);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM files").get().count, 0);
  const submission = db.prepare("SELECT * FROM submissions WHERE candidate_id='cand-reset'").get();
  assert.equal(submission.status, "not_started");
  assert.equal(submission.progress, 0);
  assert.equal(fs.readdirSync(paths.tempDir).length, 0);
  assert.equal(fs.readdirSync(paths.submissionsDir).length, 0);
  assert.equal(fs.readdirSync(paths.videoOriginalsDir).length, 0);
  assert.equal(fs.readdirSync(paths.videoMp4Dir).length, 0);
  assert.equal(fs.existsSync(exportFile), true);
  assert.equal(getSetting("position").length > 0, true);
  assert.equal(db.prepare("SELECT state FROM timer WHERE id=1").get().state, "running");
  assert.equal(listAuditLogs({ action: "preserve_audit_log" }).length, 1);
  assert.equal(listAuditLogs({ action: "test_data_cleared" }).length, 1);
});

test("reset endpoint is protected and rejects read-only sessions", async () => {
  const app = Fastify({ logger: false });
  await registerRoutes(app);
  const unauth = await app.inject({
    method: "POST",
    url: "/api/admin/reset-test-data",
    payload: { confirm: "CLEAR TEST DATA" }
  });
  assert.equal(unauth.statusCode, 401);

  const readonlyLogin = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { role: "readonly", password: "view2569" }
  });
  assert.equal(readonlyLogin.statusCode, 200);
  const readonlyToken = JSON.parse(readonlyLogin.body).token;
  const readonlyReset = await app.inject({
    method: "POST",
    url: "/api/admin/reset-test-data",
    headers: { authorization: `Bearer ${readonlyToken}` },
    payload: { confirm: "CLEAR TEST DATA" }
  });
  assert.equal(readonlyReset.statusCode, 401);
  await app.close();
});

test("admin can update candidate identity details", async () => {
  const db = openDatabase();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT OR IGNORE INTO candidates (id,sequence_no,applicant_no,full_name,note,created_at,updated_at) VALUES ('cand-edit',7,'07101007','Before Edit','',?,?)"
  ).run(now, now);
  ensureSubmission("cand-edit");

  const app = Fastify({ logger: false });
  await registerRoutes(app);
  const adminLogin = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { role: "admin", password: "admin2569" }
  });
  assert.equal(adminLogin.statusCode, 200);
  const adminToken = JSON.parse(adminLogin.body).token;

  const update = await app.inject({
    method: "PATCH",
    url: "/api/admin/candidates/cand-edit",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { sequenceNo: 8, applicantNo: "07101008", fullName: "After Edit", note: "แก้ไขจาก test" }
  });
  assert.equal(update.statusCode, 200);
  const body = JSON.parse(update.body);
  assert.equal(body.candidate.sequenceNo, 8);
  assert.equal(body.candidate.applicantNo, "07101008");
  assert.equal(body.candidate.fullName, "After Edit");
  assert.equal(body.candidate.note, "แก้ไขจาก test");

  await app.close();
});

test("audit logs can be filtered by actor, action, and candidate", () => {
  logAudit(
    "admin",
    "test_activity_logged",
    { candidateId: "cand-test", note: "filterable detail" },
    { actorRole: "admin", candidateId: "cand-test", requestMethod: "POST", requestPath: "/api/test", statusCode: 200 }
  );
  const logs = listAuditLogs({ actor: "admin", action: "test_activity", candidateId: "cand-test", q: "filterable" });
  assert.equal(logs.length >= 1, true);
  assert.equal(logs[0].actor, "admin");
  assert.equal(logs[0].candidateId, "cand-test");
  assert.equal(logs[0].requestMethod, "POST");
});

test("media allow-list classifies only intended families", () => {
  assert.equal(classifyAllowed("video/mp4"), "video");
  assert.equal(classifyAllowed("application/octet-stream", "clip.mkv"), "video");
  assert.equal(classifyAllowed("application/mxf", "clip.mxf"), "video");
  assert.equal(classifyAllowed("image/png"), "image");
  assert.equal(classifyAllowed("application/pdf"), "document");
  assert.equal(classifyAllowed("application/x-msdownload"), "unsupported");
  assert.equal(classifyAllowed("application/octet-stream", "tool.exe"), "unsupported");
});

test("video metadata follows display aspect ratio", () => {
  assert.deepEqual(
    videoDisplayMetadata({
      streams: [{ codec_type: "video", width: 1080, height: 1920, sample_aspect_ratio: "1:1" }]
    }),
    { width: 1080, height: 1920, aspectRatio: 1080 / 1920 }
  );
  assert.deepEqual(
    videoDisplayMetadata({
      streams: [{ codec_type: "video", width: 1920, height: 1080, sample_aspect_ratio: "1:1" }]
    }),
    { width: 1920, height: 1080, aspectRatio: 1920 / 1080 }
  );
});
