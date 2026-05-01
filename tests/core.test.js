import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const rootBase = path.join(process.cwd(), "runtime", "tests");
fs.mkdirSync(rootBase, { recursive: true });
const root = fs.mkdtempSync(path.join(rootBase, "nsm-exam-test-"));
process.env.EXAM_DATA_ROOT = path.join(root, "data");
process.env.EXAM_BACKUP_ROOT = path.join(root, "backup");
process.env.UPLOAD_WORKS_DIR = path.join(root, "upload_works");
process.env.PUBLIC_URL = "http://127.0.0.1:8080";

const { openDatabase, ensureSubmission, getSetting, setSetting, logAudit, listAuditLogs } = await import("../server/db.js");
const { preferredLanAddress, publicState } = await import("../server/state.js");
const { createUploadSession } = await import("../server/upload.js");
const { exportGlobalManifest } = await import("../server/exporter.js");
const { classifyAllowed, videoDisplayMetadata } = await import("../server/media.js");

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
  assert.equal(classifyAllowed("image/png"), "image");
  assert.equal(classifyAllowed("application/pdf"), "document");
  assert.equal(classifyAllowed("application/x-msdownload"), "unsupported");
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
