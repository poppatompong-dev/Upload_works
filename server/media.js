import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileTypeFromFile, fileTypeFromBuffer } from "file-type";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { uploadPolicy } from "./config.js";

const ffprobePath = ffprobeStatic.path;

export async function detectFile(filePath) {
  return (await fileTypeFromFile(filePath)) || { mime: "application/octet-stream", ext: "" };
}

export async function detectBuffer(buffer) {
  return (await fileTypeFromBuffer(buffer)) || { mime: "application/octet-stream", ext: "" };
}

export function classifyAllowed(mime) {
  if (mime?.startsWith("video/")) return "video";
  if (uploadPolicy.allowedImageMimes.has(mime)) return "image";
  if (uploadPolicy.allowedDocumentMimes.has(mime)) return "document";
  return "unsupported";
}

function runProcess(command, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Process timed out: ${path.basename(command)}`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || `${path.basename(command)} exited with ${code}`));
    });
  });
}

export async function probeVideo(filePath) {
  const { stdout } = await runProcess(
    ffprobePath,
    [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath
    ],
    60000
  );
  const parsed = JSON.parse(stdout);
  const hasVideo = Array.isArray(parsed.streams) && parsed.streams.some((s) => s.codec_type === "video");
  if (!hasVideo) throw new Error("ไม่พบ video stream ในไฟล์");
  const duration = Number(parsed.format?.duration || 0);
  return { durationSeconds: Number.isFinite(duration) ? duration : null, ...videoDisplayMetadata(parsed), info: parsed };
}

function parseRatio(value) {
  const [left, right] = String(value || "").split(":").map(Number);
  if (!Number.isFinite(left) || !Number.isFinite(right) || right === 0) return 1;
  return left / right;
}

function rotationDegrees(stream) {
  const rawRotate = stream?.tags?.rotate ?? stream?.side_data_list?.find((data) => data.rotation)?.rotation;
  const rotate = Number(rawRotate || 0);
  return Number.isFinite(rotate) ? Math.abs(rotate) % 180 : 0;
}

export function videoDisplayMetadata(probeInfo) {
  const stream = probeInfo?.streams?.find((item) => item.codec_type === "video");
  if (!stream) return { width: null, height: null, aspectRatio: null };

  let width = Number(stream.width || 0);
  let height = Number(stream.height || 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: null, height: null, aspectRatio: null };
  }

  if (rotationDegrees(stream) === 90) {
    [width, height] = [height, width];
  }

  const sampleAspectRatio = parseRatio(stream.sample_aspect_ratio);
  const displayWidth = Math.max(1, Math.round(width * sampleAspectRatio));
  const aspectRatio = displayWidth / height;
  return {
    width: displayWidth,
    height,
    aspectRatio: Number.isFinite(aspectRatio) ? aspectRatio : null
  };
}

export async function transcodePreview(inputPath, outputPath) {
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  await runProcess(
    ffmpegPath,
    [
      "-y",
      "-i",
      inputPath,
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-vf",
      "scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      outputPath
    ],
    10 * 60 * 1000
  );
}

export async function createVideoThumbnail(inputPath, outputPath) {
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  await runProcess(
    ffmpegPath,
    ["-y", "-ss", "00:00:01", "-i", inputPath, "-frames:v", "1", "-q:v", "3", outputPath],
    60000
  );
}
