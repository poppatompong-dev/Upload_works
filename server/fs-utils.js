import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export async function ensureDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
}

export function ensureDirSync(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function safeFileName(name) {
  const cleaned = String(name || "file")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 140) || "file";
}

export function assertInside(parent, target) {
  const rel = path.relative(path.resolve(parent), path.resolve(target));
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Unsafe path outside storage root");
  }
}

export async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function copyFileSafe(source, target) {
  await ensureDir(path.dirname(target));
  await fs.promises.copyFile(source, target);
}

export function getFreeBytes(root) {
  try {
    ensureDirSync(root);
    const info = fs.statfsSync(root);
    return Number(info.bavail) * Number(info.bsize);
  } catch {
    return null;
  }
}

export function toPublicPath(filePath) {
  return filePath.replace(/\\/g, "/");
}
