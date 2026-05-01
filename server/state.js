import os from "node:os";
import QRCode from "qrcode";
import { config, paths, uploadPolicy } from "./config.js";
import { adminCandidateRows, getSetting, publicCandidateRows, timerRow } from "./db.js";
import { getFreeBytes } from "./fs-utils.js";

export function localLanUrl() {
  const override = process.env.PUBLIC_URL || getSetting("publicUrl", "");
  if (override) return override;
  const address = preferredLanAddress(os.networkInterfaces());
  if (address) return `http://${address}:${config.port}`;
  return `http://localhost:${config.port}`;
}

export function preferredLanAddress(nets) {
  const candidates = [];
  const skipInterface = /(?:loopback|virtual|vmware|vbox|hyper-v|wsl|vpn|tunnel|teredo|isatap|docker|bluetooth)/i;
  for (const [name, values] of Object.entries(nets)) {
    const virtualPenalty = skipInterface.test(name) ? 100 : 0;
    for (const item of values || []) {
      if (!isUsableIpv4(item)) continue;
      candidates.push({
        address: item.address,
        score: virtualPenalty + interfacePenalty(name) + addressPenalty(item.address)
      });
    }
  }
  candidates.sort((a, b) => a.score - b.score || a.address.localeCompare(b.address));
  return candidates[0]?.address || "";
}

function isUsableIpv4(item) {
  return (
    item?.family === "IPv4" &&
    !item.internal &&
    !item.address.startsWith("127.") &&
    !item.address.startsWith("169.254.")
  );
}

function interfacePenalty(name) {
  if (/wi-?fi|wireless|wlan/i.test(name)) return 0;
  if (/ethernet|lan/i.test(name)) return 10;
  return 30;
}

function addressPenalty(address) {
  if (address.startsWith("192.168.")) return 0;
  if (/^10\./.test(address)) return 5;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 10;
  return 50;
}

export function settingsPayload() {
  return {
    examTitle: getSetting("examTitle", config.exam.title),
    organization: getSetting("organization", config.exam.organization),
    position: getSetting("position", config.exam.position),
    location: getSetting("location", config.exam.location),
    reportTime: getSetting("reportTime", config.exam.reportTime),
    durationSeconds: Number(getSetting("durationSeconds", config.exam.durationSeconds)),
    taskDescription: getSetting("taskDescription", config.exam.taskDescription),
    instructions: getSetting("instructions", config.exam.instructions),
    announcement: getSetting("announcement", ""),
    publicUrl: localLanUrl(),
    wifiQrAvailable: getSetting("wifiQrPath", "") !== ""
  };
}

export function timerPayload() {
  const timer = timerRow();
  const now = Date.now();
  const deadline = timer?.deadline_at ? Date.parse(timer.deadline_at) : null;
  return {
    state: timer?.state || "idle",
    durationSeconds: timer?.duration_seconds || config.exam.durationSeconds,
    startAt: timer?.start_at || null,
    deadlineAt: timer?.deadline_at || null,
    extendedSeconds: timer?.extended_seconds || 0,
    remainingSeconds:
      timer?.state === "running" && deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0
  };
}

export function statsFor(rows) {
  const counts = {
    total: rows.length,
    not_started: 0,
    uploading: 0,
    verifying: 0,
    ready_to_confirm: 0,
    candidate_confirmed: 0,
    admin_confirmed: 0,
    confirmed: 0,
    needs_resubmit: 0,
    expired: 0
  };
  for (const row of rows) counts[row.status] = (counts[row.status] || 0) + 1;
  return counts;
}

export function systemWarnings() {
  const dataFree = getFreeBytes(config.dataRoot);
  const backupFree = getFreeBytes(config.backupRoot);
  const warnings = [];
  if (dataFree !== null && dataFree < uploadPolicy.lowDiskWarningBytes) {
    warnings.push("พื้นที่ D: สำหรับเก็บไฟล์หลักเหลือน้อยกว่า 20 GB");
  }
  if (backupFree !== null && backupFree < uploadPolicy.lowDiskWarningBytes) {
    warnings.push("พื้นที่ C: สำหรับสำรองเหลือน้อยกว่า 20 GB");
  }
  return {
    dataFreeBytes: dataFree,
    backupFreeBytes: backupFree,
    warnings,
    dataRoot: config.dataRoot,
    backupRoot: config.backupRoot,
    uploadWorksRoot: config.uploadWorksRoot
  };
}

export async function publicState() {
  const candidates = publicCandidateRows().map((row) => ({
    id: row.id,
    sequenceNo: row.sequence_no,
    applicantNo: row.applicant_no,
    status: row.status,
    progress: row.progress,
    confirmedAt: row.confirmed_at,
    candidateConfirmedAt: row.candidate_confirmed_at,
    adminConfirmedAt: row.admin_confirmed_at,
    errorMessage: row.status === "needs_resubmit" ? row.error_message : null
  }));
  const settings = settingsPayload();
  return {
    settings,
    systemUrlQr: await QRCode.toDataURL(settings.publicUrl, { margin: 1, width: 320 }),
    timer: timerPayload(),
    stats: statsFor(candidates),
    candidates,
    system: systemWarnings()
  };
}

export async function adminState() {
  const candidates = adminCandidateRows().map((row) => ({
    id: row.id,
    sequenceNo: row.sequence_no,
    applicantNo: row.applicant_no,
    fullName: row.full_name,
    note: row.note,
    status: row.status,
    progress: row.progress,
    activeUploadId: row.active_upload_id,
    startedAt: row.started_at,
    uploadCompletedAt: row.upload_completed_at,
    verifyingAt: row.verifying_at,
    verifiedAt: row.verified_at,
    confirmedAt: row.confirmed_at,
    candidateConfirmedAt: row.candidate_confirmed_at,
    adminConfirmedAt: row.admin_confirmed_at,
    errorMessage: row.error_message,
    backupStatus: row.backup_status,
    backupError: row.backup_error
  }));
  return {
    settings: settingsPayload(),
    timer: timerPayload(),
    stats: statsFor(candidates),
    candidates,
    system: systemWarnings()
  };
}

export { paths };
