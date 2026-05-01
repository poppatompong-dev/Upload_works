import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const rootBase = path.join(process.cwd(), "runtime", "tests");
fs.mkdirSync(rootBase, { recursive: true });
const root = fs.mkdtempSync(path.join(rootBase, "nsm-upload-test-"));
process.env.EXAM_DATA_ROOT = path.join(root, "data");
process.env.EXAM_BACKUP_ROOT = path.join(root, "backup");
process.env.UPLOAD_WORKS_DIR = path.join(root, "upload_works");
process.env.PUBLIC_URL = "http://127.0.0.1:18080";

const ffmpegPath = (await import("ffmpeg-static")).default;
const { openDatabase, ensureSubmission } = await import("../server/db.js");
const { createUploadSession, acceptChunk, confirmSubmission, confirmSubmissionByAdmin } = await import("../server/upload.js");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `${command} exited with ${code}`));
    });
  });
}

async function waitForStatus(candidateId, statuses) {
  const db = openDatabase();
  const expected = new Set(statuses);
  const started = Date.now();
  while (Date.now() - started < 30000) {
    const row = db.prepare("SELECT * FROM submissions WHERE candidate_id=?").get(candidateId);
    if (expected.has(row.status)) return row;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  const row = db.prepare("SELECT * FROM submissions WHERE candidate_id=?").get(candidateId);
  throw new Error(`Timed out waiting for ${statuses.join(", ")}; got ${row.status}: ${row.error_message || ""}`);
}

test("chunk upload verifies, transcodes, confirms, and backs up a video", async () => {
  const db = openDatabase();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO candidates (id,sequence_no,applicant_no,full_name,note,created_at,updated_at) VALUES ('cand-flow',1,'07101001','ทดสอบ ระบบ','',?,?)"
  ).run(now, now);
  ensureSubmission("cand-flow");
  const deadline = new Date(Date.now() + 60000).toISOString();
  db.prepare(
    "UPDATE timer SET state='running', start_at=?, deadline_at=?, duration_seconds=60, updated_at=? WHERE id=1"
  ).run(now, deadline, now);

  const sample = path.join(root, "sample.mp4");
  await run(ffmpegPath, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=teal:s=320x180:d=1",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=44100:cl=mono",
    "-shortest",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    sample
  ]);
  const body = fs.readFileSync(sample);
  const session = createUploadSession("cand-flow", [
    { name: "sample.mp4", size: body.length, type: "video/mp4", category: "video", totalChunks: 1 }
  ]);
  await acceptChunk({
    uploadId: session.uploadId,
    fileId: session.files[0].id,
    chunkIndex: 0,
    body
  });

  const ready = await waitForStatus("cand-flow", ["ready_to_confirm", "needs_resubmit"]);
  assert.equal(ready.status, "ready_to_confirm", ready.error_message || "");
  const file = db.prepare("SELECT * FROM files WHERE candidate_id='cand-flow'").get();
  assert.equal(file.status, "verified");
  assert.ok(file.sha256);
  assert.ok(fs.existsSync(file.preview_path));
  assert.equal(file.video_width, 320);
  assert.equal(file.video_height, 180);
  assert.equal(file.aspect_ratio, 320 / 180);

  const confirmed = confirmSubmission("cand-flow");
  assert.equal(confirmed.status, "candidate_confirmed");
  assert.ok(confirmed.candidate_confirmed_at);

  const adminConfirmed = confirmSubmissionByAdmin("cand-flow");
  assert.equal(adminConfirmed.status, "confirmed");
  assert.ok(adminConfirmed.admin_confirmed_at);
  const afterBackup = await waitForStatus("cand-flow", ["confirmed"]);
  assert.ok(afterBackup.candidate_confirmed_at);
  assert.ok(afterBackup.admin_confirmed_at);
  assert.ok(afterBackup.confirmed_at);
});
