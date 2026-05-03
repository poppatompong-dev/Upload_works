import type { SubmissionFile, SubmissionStatus } from "./types";

const videoExtensions = new Set([
  ".3g2",
  ".3gp",
  ".3gpp",
  ".asf",
  ".avi",
  ".divx",
  ".dv",
  ".f4v",
  ".flv",
  ".hevc",
  ".m1v",
  ".m2t",
  ".m2ts",
  ".m2v",
  ".m4v",
  ".mjpeg",
  ".mjpg",
  ".mkv",
  ".mov",
  ".mp4",
  ".mpe",
  ".mpeg",
  ".mpg",
  ".mts",
  ".mxf",
  ".ogm",
  ".ogv",
  ".qt",
  ".rm",
  ".rmvb",
  ".tod",
  ".ts",
  ".vob",
  ".webm",
  ".wmv",
  ".xvid"
]);

function fileExtension(name = "") {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
}

export function isKnownVideoFileName(name = "") {
  return videoExtensions.has(fileExtension(name));
}

export function statusLabel(status: SubmissionStatus) {
  const map: Record<SubmissionStatus, string> = {
    not_started: "ยังไม่เริ่ม",
    uploading: "กำลังส่ง",
    verifying: "กำลังตรวจไฟล์",
    ready_to_confirm: "รอยืนยัน",
    candidate_confirmed: "ผู้ส่งรับรองแล้ว",
    admin_confirmed: "กรรมการรับรองแล้ว",
    confirmed: "ยืนยันแล้ว",
    needs_resubmit: "ต้องส่งใหม่",
    expired: "หมดเวลา",
    admin_unlocked: "เปิดสิทธิ์ใหม่"
  };
  return map[status] || status;
}

export function statusTone(status: SubmissionStatus) {
  if (status === "confirmed") return "ok";
  if (status === "candidate_confirmed") return "candidate";
  if (status === "admin_confirmed") return "admin";
  if (status === "ready_to_confirm") return "ready";
  if (status === "verifying") return "verify";
  if (status === "needs_resubmit" || status === "expired") return "bad";
  if (status === "admin_unlocked") return "unlock";
  if (status === "uploading") return "upload";
  return "muted";
}

export function formatSeconds(total: number) {
  const safe = Math.max(0, Math.floor(total || 0));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatBytes(bytes: number | null | undefined) {
  if (bytes == null) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function fileCategory(file: File): "video" | "image" | "document" | "unsupported" {
  if (file.type.startsWith("video/") || isKnownVideoFileName(file.name)) return "video";
  if (file.type.startsWith("image/")) return "image";
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return "document";
  return "unsupported";
}

export function isPreviewableImage(file: SubmissionFile) {
  return file.detectedType?.startsWith("image/");
}

export function isPreviewableVideo(file: SubmissionFile) {
  return file.category === "video" || file.detectedType?.startsWith("video/");
}

export function isPreviewablePdf(file: SubmissionFile) {
  return file.detectedType === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export function shortHash(hash?: string | null) {
  return hash ? `${hash.slice(0, 12)}...${hash.slice(-8)}` : "-";
}

export function displayDateTime(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "short",
    timeStyle: "medium"
  }).format(new Date(value));
}
