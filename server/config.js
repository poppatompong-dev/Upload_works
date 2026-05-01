import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(serverDir, "..");

export const config = {
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || "0.0.0.0",
  dataRoot: process.env.EXAM_DATA_ROOT || "D:\\ExamSubmissions\\PR-2569",
  backupRoot: process.env.EXAM_BACKUP_ROOT || "C:\\ExamSubmissionsBackup\\PR-2569",
  uploadWorksRoot:
    process.env.UPLOAD_WORKS_DIR || path.join(os.homedir(), "Documents", "Upload_Works"),
  adminPassword: process.env.EXAM_ADMIN_PASSWORD || "Admin@PR2569",
  readOnlyPassword: process.env.EXAM_READONLY_PASSWORD || "View@PR2569",
  exam: {
    title: "การสอบปฏิบัติตำแหน่งผู้ช่วยนักประชาสัมพันธ์",
    organization: "เทศบาลนครนครสวรรค์",
    position: "ผู้ช่วยนักประชาสัมพันธ์",
    location: "ห้องประชุม 3/3 ชั้น 3 สำนักงานเทศบาลนครนครสวรรค์",
    reportTime: "12:45 น.",
    durationSeconds: 60 * 60,
    taskDescription:
      "ผลิต clip วิดีโอความยาวไม่เกิน 1 นาทีเกี่ยวกับสถานที่ท่องเที่ยวภายในจังหวัดนครสวรรค์",
    instructions:
      "ส่งไฟล์วิดีโออย่างน้อย 1 ไฟล์ผ่านระบบ เปิดดูตัวอย่างหลังระบบตรวจเสร็จ แล้วกดยืนยันการส่งงานก่อนหมดเวลา"
  }
};

export const paths = {
  dbDir: path.join(config.dataRoot, "database"),
  dbPath: path.join(config.dataRoot, "database", "exam.db"),
  submissionsDir: path.join(config.dataRoot, "submissions"),
  tempDir: path.join(config.dataRoot, "_tmp"),
  exportsDir: path.join(config.dataRoot, "exports"),
  logsDir: path.join(config.dataRoot, "logs"),
  backupSubmissionsDir: path.join(config.backupRoot, "submissions"),
  backupExportsDir: path.join(config.backupRoot, "exports"),
  uploadWorksRosterDir: path.join(config.uploadWorksRoot, "roster"),
  uploadWorksAssetsDir: path.join(config.uploadWorksRoot, "assets"),
  clientDist: path.join(projectRoot, "dist", "client")
};

export const uploadPolicy = {
  chunkBytes: 4 * 1024 * 1024,
  lowDiskWarningBytes: 20 * 1024 * 1024 * 1024,
  allowedImageMimes: new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  allowedDocumentMimes: new Set(["application/pdf"])
};
