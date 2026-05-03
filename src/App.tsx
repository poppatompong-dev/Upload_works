import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Activity,
  ArrowLeft,
  Bell,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  Eye,
  FileCheck2,
  FileVideo,
  ListFilter,
  Lock,
  LogOut,
  Monitor,
  Play,
  Printer,
  QrCode,
  RefreshCw,
  RotateCcw,
  Settings,
  Search,
  ShieldCheck,
  Square,
  Trash2,
  Upload,
  UsersRound,
  Wifi
} from "lucide-react";
import { api, ApiError, CHUNK_BYTES } from "./api";
import { useRealtime } from "./hooks";
import type {
  AdminState,
  AuditLogEntry,
  AuditLogFilters,
  CandidateDetail,
  CandidateSummary,
  PublicState,
  SubmitState,
  SubmissionFile
} from "./types";
import {
  displayDateTime,
  fileCategory,
  formatBytes,
  formatSeconds,
  isPreviewableImage,
  isPreviewablePdf,
  isPreviewableVideo,
  shortHash,
  statusLabel,
  statusTone
} from "./utils";

const candidateTokenKey = "exam:candidateToken";
const candidateIdKey = "exam:candidateId";
const adminTokenKey = "exam:adminToken";
const adminRoleKey = "exam:adminRole";
const googleDriveFallbackUrl = "https://drive.google.com/drive/folders/1QZ7WYaTd6OiXOzMcfsnxSnQnmSUPl-UT?usp=sharing";
const timerMilestones = {
  thirtyMinutes: 30 * 60,
  fortyFiveMinutes: 45 * 60,
  fiveMinutesLeft: 5 * 60
};

type TimerLike = PublicState["timer"] | AdminState["timer"] | null | undefined;
type ProjectorView = "grid" | "table" | "cards" | "vertical" | "horizontal";
type ProjectorMonitorMode = "grid" | "ticker";
type AdminSection = "overview" | "candidates" | "settings" | "reports";

function clearStoredCandidateIdentity() {
  localStorage.removeItem(candidateTokenKey);
  localStorage.removeItem(candidateIdKey);
}

function initialCandidateSession() {
  if (window.location.pathname === "/submit") {
    clearStoredCandidateIdentity();
    return { token: "", candidateId: "" };
  }
  return {
    token: localStorage.getItem(candidateTokenKey) || "",
    candidateId: localStorage.getItem(candidateIdKey) || ""
  };
}

function initialCandidateIdentifier() {
  return new URLSearchParams(window.location.search).get("candidate") || "";
}

function getCountdownSeconds(timer: TimerLike) {
  if (!timer) return 0;
  if (timer.state === "running" && timer.deadlineAt) {
    return Math.max(0, Math.ceil((new Date(timer.deadlineAt).getTime() - Date.now()) / 1000));
  }
  return Math.max(0, Math.floor(timer.remainingSeconds || 0));
}

function useCountdownSeconds(timer: TimerLike) {
  const [remainingSeconds, setRemainingSeconds] = useState(() => getCountdownSeconds(timer));

  useEffect(() => {
    setRemainingSeconds(getCountdownSeconds(timer));
    if (timer?.state !== "running" || !timer.deadlineAt) return;

    const id = window.setInterval(() => {
      setRemainingSeconds(getCountdownSeconds(timer));
    }, 1000);

    return () => window.clearInterval(id);
  }, [timer]);

  return remainingSeconds;
}

function elapsedSecondsForTimer(timer: TimerLike, remainingSeconds: number) {
  if (!timer) return 0;
  if (timer.state === "running" && timer.startAt) {
    return Math.max(0, Math.floor((Date.now() - new Date(timer.startAt).getTime()) / 1000));
  }
  const total = Math.max(0, (timer.durationSeconds || 0) + (timer.extendedSeconds || 0));
  return Math.max(0, total - remainingSeconds);
}

function timerNotice(timer: TimerLike, remainingSeconds: number) {
  if (!timer) return null;
  const ended = timer.state === "ended" || (timer.state === "running" && remainingSeconds <= 0);
  if (ended) {
    return {
      tone: "bad",
      title: "หมดเวลาสอบแล้ว",
      detail: "ระบบปิดรับงานตามเวลาสอบ ทุกหน้าจะแสดงสถานะหมดเวลาให้ผู้เข้าสอบและกรรมการเห็นตรงกัน"
    };
  }
  if (timer.state !== "running") return null;
  const elapsed = elapsedSecondsForTimer(timer, remainingSeconds);
  if (remainingSeconds <= timerMilestones.fiveMinutesLeft) {
    return { tone: "bad", title: "เหลือเวลาอีก 5 นาที", detail: "กรุณาเร่งตรวจไฟล์และยืนยันการส่งงานให้เรียบร้อย" };
  }
  if (elapsed >= timerMilestones.fortyFiveMinutes) {
    return { tone: "warning", title: "เวลาสอบผ่านไป 45 นาที", detail: "ช่วงท้ายของการสอบเริ่มใกล้เข้ามาแล้ว" };
  }
  if (elapsed >= timerMilestones.thirtyMinutes) {
    return { tone: "info", title: "เวลาสอบผ่านไป 30 นาที", detail: "ระบบแจ้งเตือนครึ่งทางของการสอบปฏิบัติ" };
  }
  return null;
}

export function App() {
  const path = window.location.pathname;
  if (path.startsWith("/admin/logs")) return <AdminLogsPage />;
  if (path.startsWith("/admin")) return <AdminPage />;
  if (path.startsWith("/projector")) return <ProjectorPage />;
  if (path.startsWith("/portal")) return <PortalPage />;
  if (path.startsWith("/submit") || path.startsWith("/candidate")) return <CandidatePage />;
  if (path === "/" || path === "") return <CandidatePage />;
  return <CandidatePage />;
}

function PortalPage() {
  const [state, setState] = useState<PublicState | null>(null);

  const refresh = useCallback(async () => {
    setState(await api.publicState());
  }, []);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);
  useRealtime(() => refresh().catch(() => undefined));

  return (
    <main className="app-shell portal-shell">
      <section className="portal-hero">
        <img className="brand-logo hero-brand-logo" src="/municipality-logo.png" alt="โลโก้เทศบาลนครนครสวรรค์" />
        <div>
          <p className="system-name">{state?.settings.organization || "เทศบาลนครนครสวรรค์"}</p>
          <h1>ระบบส่งผลงานสอบปฏิบัติ</h1>
          <p>{state?.settings.examTitle || "การสอบปฏิบัติตำแหน่งผู้ช่วยนักประชาสัมพันธ์"}</p>
        </div>
        <TimerPill timer={state?.timer} />
      </section>
      <TimerNotice timer={state?.timer} />

      <section className="portal-grid">
        <a className="portal-card primary" href="/submit">
          <div className="card-icon-box primary-icon">
            <Upload size={28} />
          </div>
          <div>
            <h2>ผู้เข้าสอบส่งผลงาน</h2>
            <p>เลือกเลขผู้สมัคร อัปโหลดไฟล์ และยืนยันส่งงาน</p>
          </div>
        </a>
        <a className="portal-card" href="/admin">
          <div className="card-icon-box">
            <ShieldCheck size={28} />
          </div>
          <div>
            <h2>กรรมการควบคุมสอบ</h2>
            <p>ดูภาพรวม ตรวจไฟล์ ควบคุมเวลา และ export</p>
          </div>
        </a>
        <a className="portal-card" href="/projector" target="_blank" rel="noreferrer">
          <div className="card-icon-box">
            <Monitor size={28} />
          </div>
          <div>
            <h2>จอโปรเจคเตอร์</h2>
            <p>แสดง QR, countdown และสถานะส่งงาน</p>
          </div>
        </a>
        <a className="portal-card backup" href={googleDriveFallbackUrl} target="_blank" rel="noreferrer">
          <div className="card-icon-box">
            <ExternalLink size={28} />
          </div>
          <div>
            <h2>ช่องทางส่งงานสำรอง</h2>
            <p>เปิด Google Drive สำหรับกรณีระบบหลักมีปัญหาและกรรมการแจ้งให้ใช้ช่องทางสำรอง</p>
          </div>
        </a>
      </section>

      <section className="panel portal-status">
        <div className="panel-heading">
          <div>
            <h2>สถานะระบบปัจจุบัน</h2>
            <p>{state?.settings.taskDescription}</p>
          </div>
          <UsersRound size={28} />
        </div>
        <StatCards stats={state?.stats} />
      </section>
    </main>
  );
}

function CandidatePage() {
  const [identifier, setIdentifier] = useState(() => initialCandidateIdentifier());
  const [initialSession] = useState(() => initialCandidateSession());
  const [token, setToken] = useState(initialSession.token);
  const [candidateId, setCandidateId] = useState(initialSession.candidateId);
  const [candidate, setCandidate] = useState<CandidateDetail | null>(null);
  const [publicState, setPublicState] = useState<SubmitState | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [localProgress, setLocalProgress] = useState(0);
  const [preview, setPreview] = useState<{ file: SubmissionFile; url: string } | null>(null);
  const [previewConfirmed, setPreviewConfirmed] = useState(false);

  const refresh = useCallback(async () => {
    const [pub, detail] = await Promise.all([
      api.submitState(),
      token && candidateId ? api.candidate(token, candidateId).catch(() => null) : Promise.resolve(null)
    ]);
    setPublicState(pub);
    if (detail) setCandidate(detail);
  }, [token, candidateId]);

  useEffect(() => {
    refresh().catch(() => undefined);
    const id = window.setInterval(() => refresh().catch(() => undefined), 2000);
    return () => window.clearInterval(id);
  }, [refresh]);
  useRealtime(() => refresh().catch(() => undefined));

  async function lookup() {
    setBusy(true);
    setError("");
    try {
      const result = await api.lookupCandidate(identifier);
      setToken(result.token);
      setCandidateId(result.candidate.id);
      setCandidate(result.candidate);
      localStorage.setItem(candidateTokenKey, result.token);
      localStorage.setItem(candidateIdKey, result.candidate.id);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function resetIdentity() {
    clearStoredCandidateIdentity();
    setToken("");
    setCandidateId("");
    setCandidate(null);
    setIdentifier("");
    setPreview(null);
    setPreviewConfirmed(false);
  }

  async function startUpload() {
    if (!candidate || !token) return;
    setBusy(true);
    setError("");
    setMessage("");
    setLocalProgress(0);
    setPreview(null);
    setPreviewConfirmed(false);
    try {
      const files = selectedFiles.map((file) => ({
        file,
        category: fileCategory(file),
        totalChunks: Math.max(1, Math.ceil(file.size / CHUNK_BYTES))
      }));
      if (!files.some((entry) => entry.category === "video")) {
        throw new Error("ต้องเลือกไฟล์วิดีโออย่างน้อย 1 ไฟล์");
      }
      const unsupported = files.find((entry) => entry.category === "unsupported");
      if (unsupported) throw new Error(`ไฟล์ ${unsupported.file.name} ไม่ใช่วิดีโอ รูปภาพ หรือ PDF`);
      const session = await api.createUploadSession(
        token,
        candidate.id,
        files.map((entry) => ({
          name: entry.file.name,
          size: entry.file.size,
          type: entry.file.type,
          category: entry.category,
          totalChunks: entry.totalChunks
        }))
      );
      let sentChunks = 0;
      const totalChunks = files.reduce((sum, entry) => sum + entry.totalChunks, 0);
      for (const entry of files) {
        const serverFile = session.files.find((item) => item.fileIndex === files.indexOf(entry));
        if (!serverFile) throw new Error("ระบบสร้าง upload session ไม่ครบ");
        for (let chunkIndex = 0; chunkIndex < entry.totalChunks; chunkIndex += 1) {
          const start = chunkIndex * CHUNK_BYTES;
          const end = Math.min(entry.file.size, start + CHUNK_BYTES);
          await api.uploadChunk(
            token,
            candidate.id,
            session.uploadId,
            serverFile.id,
            chunkIndex,
            entry.file.slice(start, end)
          );
          sentChunks += 1;
          setLocalProgress(Math.round((sentChunks / totalChunks) * 100));
        }
      }
      setMessage("ส่งไฟล์ครบแล้ว ระบบกำลังตรวจความสมบูรณ์และสร้างไฟล์ตัวอย่าง");
      await refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function openPreview(file: SubmissionFile) {
    if (!token) return;
    setError("");
    try {
      const result = await api.fileLink(token, file.id, "preview");
      setPreview({ file, url: result.url });
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function confirm() {
    if (!candidate || !token) return;
    setBusy(true);
    setError("");
    try {
      await api.confirm(token, candidate.id);
      await refresh();
      setMessage("ยืนยันการส่งงานสำเร็จ");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function downloadProofImage() {
    if (!candidate?.submission.candidateConfirmedAt) return;
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 820;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#f0fdf4";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, 54, 54, 1092, 712, 28);
    ctx.fill();
    ctx.strokeStyle = "#16a34a";
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.fillStyle = "#15803d";
    ctx.font = "bold 44px Prompt, Sarabun, sans-serif";
    ctx.fillText("หลักฐานการยืนยันส่งผลงาน", 96, 140);
    ctx.fillStyle = "#14213d";
    ctx.font = "bold 78px Prompt, Sarabun, sans-serif";
    ctx.fillText(String(candidate.sequenceNo).padStart(2, "0"), 96, 250);
    ctx.font = "bold 36px Prompt, Sarabun, sans-serif";
    ctx.fillText(`ผู้เข้าสอบลำดับที่ ${candidate.sequenceNo}`, 230, 230);
    ctx.fillStyle = "#475569";
    ctx.font = "28px Prompt, Sarabun, sans-serif";
    ctx.fillText(`เลขประจำตัวสอบ: ${candidate.applicantNo}`, 230, 282);
    ctx.fillText(`ชื่อ - นามสกุล: ${candidate.fullName || "-"}`, 230, 334);
    ctx.fillText(`ยืนยันเมื่อ: ${displayDateTime(candidate.submission.candidateConfirmedAt)}`, 96, 432);
    ctx.fillText(`จำนวนไฟล์ที่ตรวจผ่าน: ${verifiedFiles.length} ไฟล์`, 96, 486);
    ctx.fillStyle = "#16a34a";
    ctx.font = "bold 34px Prompt, Sarabun, sans-serif";
    ctx.fillText("สถานะ: ยืนยันการส่งงานแล้ว", 96, 572);
    ctx.fillStyle = "#64748b";
    ctx.font = "22px Prompt, Sarabun, sans-serif";
    ctx.fillText(publicState?.settings.organization || "ระบบส่งผลงานสอบปฏิบัติ", 96, 690);
    const link = document.createElement("a");
    link.download = `submission-proof-${candidate.applicantNo}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  const timer = publicState?.timer;
  const remainingSeconds = useCountdownSeconds(timer);
  const canUpload = timer?.state === "running" && remainingSeconds > 0;
  const status = candidate?.submission.status || "not_started";
  const verifiedFiles = candidate?.files.filter((file) => file.status === "verified") || [];
  const candidateConfirmed = Boolean(candidate?.submission.candidateConfirmedAt);
  const canCandidateConfirm =
    Boolean(candidate) &&
    verifiedFiles.length > 0 &&
    !candidateConfirmed &&
    ["ready_to_confirm", "admin_confirmed"].includes(status);

  return (
    <main className="app-shell candidate-shell">
      <section className="candidate-hero">
        <img className="brand-logo hero-brand-logo" src="/municipality-logo.png" alt="โลโก้เทศบาลนครนครสวรรค์" />
        <div>
          <p className="system-name">{publicState?.settings.organization || "เทศบาลนครนครสวรรค์"}</p>
          <h1>ระบบส่งผลงานสอบปฏิบัติ</h1>
          <p>{publicState?.settings.taskDescription || "ผลิต clip วิดีโอความยาวไม่เกิน 1 นาที"}</p>
        </div>
        <TimerPill timer={timer} />
      </section>
      <TimerNotice timer={timer} />

      {publicState?.settings.announcement ? (
        <div className="notice info">
          <AlertTriangle size={18} />
          <span>{publicState.settings.announcement}</span>
        </div>
      ) : null}

      {!candidate ? (
        <section className="panel login-panel">
          <div className="login-icon-wrap">
            <ShieldCheck size={32} />
          </div>
          <div className="candidate-select-copy">
            <h2>ยืนยันตัวผู้เข้าสอบ</h2>
            <p>สแกน QR แล้วระบบจะเริ่มใหม่ทุกครั้ง กรุณากรอกลำดับที่หรือเลขประจำตัวสอบตามบัตรของท่าน</p>
          </div>
          <ol className="login-steps">
            <li><span>1</span>กรอกเลขผู้สมัครหรือลำดับที่</li>
            <li><span>2</span>ตรวจสอบเลขลำดับและเลขประจำตัวสอบให้ถูกต้อง</li>
            <li><span>3</span>เลือกไฟล์วิดีโอและอัปโหลด</li>
          </ol>
          <div className="candidate-select-form">
            <input
              type="text"
              value={identifier}
              onChange={(event) => {
                setIdentifier(event.target.value);
                setError("");
              }}
              placeholder="เช่น 1 หรือ 07101001"
              inputMode="numeric"
              onKeyDown={(event) => {
                if (event.key === "Enter") lookup();
              }}
            />
            <button onClick={lookup} disabled={busy || !identifier.trim()}>
              <Play size={18} />
              เข้าสู่ระบบ
            </button>
          </div>
          {error ? <p className="form-error">{error}</p> : null}
        </section>
      ) : (
        <section className="candidate-grid">
          <div className="panel identity-panel">
            <div className="panel-heading">
              <div>
                <h2>ข้อมูลผู้เข้าสอบ</h2>
                <p>ตรวจสอบเลขลำดับและเลขประจำตัวสอบให้ตรงกับบัตรก่อนอัปโหลด</p>
              </div>
              <button className="ghost" onClick={resetIdentity}>
                <LogOut size={16} />
                เปลี่ยนผู้เข้าสอบ
              </button>
            </div>
            <div className="identity-list">
              <span>ลำดับที่</span>
              <strong>{candidate.sequenceNo}</strong>
              <span>เลขสมัคร</span>
              <strong>{candidate.applicantNo}</strong>
              <span>ชื่อ - นามสกุล</span>
              <strong>{candidate.fullName || "-"}</strong>
              <span>สถานะ</span>
              <CandidateStatusBadge status={status} progress={candidate.submission.progress || localProgress} />
            </div>
          </div>

          <div className="panel upload-panel">
            <div className="panel-heading">
              <div>
                <h2>ส่งไฟล์ผลงาน</h2>
                <p>ต้องมีวิดีโออย่างน้อย 1 ไฟล์ รองรับรูปภาพและ PDF เพิ่มเติม</p>
              </div>
              <Upload size={28} />
            </div>
            <div className="dropzone-wrap">
              <input
                className="file-input"
                type="file"
                multiple
                accept="video/*,.3g2,.3gp,.3gpp,.asf,.avi,.divx,.dv,.f4v,.flv,.hevc,.m1v,.m2t,.m2ts,.m2v,.m4v,.mjpeg,.mjpg,.mkv,.mov,.mp4,.mpe,.mpeg,.mpg,.mts,.mxf,.ogm,.ogv,.qt,.rm,.rmvb,.tod,.ts,.vob,.webm,.wmv,.xvid,image/*,application/pdf"
                disabled={!canUpload || busy || candidateConfirmed}
                onChange={(event) => setSelectedFiles(Array.from(event.target.files || []))}
              />
              <p className="dropzone-hint">
                <Upload size={13} />
                คลิกเพื่อเลือกไฟล์ — วิดีโอ รูปภาพ หรือ PDF
              </p>
            </div>
            <FileList files={selectedFiles} />
            <div className="progress-track">
              <div style={{ width: `${candidate.submission.progress || localProgress}%` }} />
            </div>
            <button
              className="primary-action"
              disabled={!canUpload || busy || selectedFiles.length === 0 || candidateConfirmed}
              onClick={startUpload}
            >
              <Upload size={20} />
              อัปโหลดผลงาน
            </button>
            {!canUpload ? <p className="form-error">ระบบยังไม่เปิดรับหรือหมดเวลาส่งงานแล้ว</p> : null}
            <BackupSubmissionLink />
            {message ? <p className="form-ok">{message}</p> : null}
            {error ? <p className="form-error">{error}</p> : null}
          </div>

          <div className="panel verify-panel">
            <div className="panel-heading">
              <div>
                <h2>ตรวจดูและยืนยัน</h2>
                <p>เปิดดูไฟล์ตัวอย่างให้ครบ แล้วกดยืนยันเมื่อแน่ใจว่าไฟล์ถูกต้อง</p>
              </div>
              <FileCheck2 size={28} />
            </div>
            <CandidateReviewStatus confirmedAt={candidate.submission.candidateConfirmedAt} />
            <SubmissionFiles files={verifiedFiles} onPreview={openPreview} />
            {preview ? <PreviewBox preview={preview} /> : null}
            {canCandidateConfirm ? (
              <label className="confirm-check">
                <input
                  type="checkbox"
                  checked={previewConfirmed}
                  onChange={(event) => setPreviewConfirmed(event.target.checked)}
                />
                <span>ข้าพเจ้าเปิดดูตัวอย่างแล้ว และยืนยันว่าไฟล์ผลงานเปิดดูได้ถูกต้อง</span>
              </label>
            ) : null}
            <button
              className="primary-action"
              disabled={busy || !previewConfirmed || !canCandidateConfirm}
              onClick={confirm}
            >
              <CheckCircle2 size={20} />
              รับรองว่าเปิดดูได้ถูกต้อง
            </button>
            {candidateConfirmed ? (
              <ConfirmationCard confirmedAt={candidate.submission.candidateConfirmedAt} onDownload={downloadProofImage} />
            ) : null}
            {candidate.submission.errorMessage ? (
              <p className="form-error">{candidate.submission.errorMessage}</p>
            ) : null}
          </div>
        </section>
      )}
    </main>
  );
}

function AdminPage() {
  const [token, setToken] = useState(() => localStorage.getItem(adminTokenKey) || "");
  const [role, setRole] = useState<"admin" | "readonly">(
    () => (localStorage.getItem(adminRoleKey) as "admin" | "readonly") || "admin"
  );
  const [password, setPassword] = useState("");
  const [publicState, setPublicState] = useState<PublicState | null>(null);
  const [state, setState] = useState<AdminState | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<CandidateDetail | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<{ file: SubmissionFile; url: string } | null>(null);
  const [adminSection, setAdminSection] = useState<AdminSection>("overview");

  const isReadOnly = role === "readonly";

  const refresh = useCallback(async () => {
    if (!token) return;
    const next = await api.adminState(token);
    setState(next);
    if (selectedId) {
      setDetail(await api.adminCandidate(token, selectedId));
    }
  }, [token, selectedId]);

  const refreshPublic = useCallback(async () => {
    setPublicState(await api.publicState());
  }, []);

  useEffect(() => {
    if (token) {
      refresh().catch((err) => setError(errorText(err)));
    } else {
      refreshPublic().catch(() => undefined);
    }
  }, [token, refresh, refreshPublic]);
  useRealtime(() => {
    (token ? refresh() : refreshPublic()).catch(() => undefined);
  });

  async function login() {
    setError("");
    try {
      const result = await api.login(password, role);
      setToken(result.token);
      localStorage.setItem(adminTokenKey, result.token);
      localStorage.setItem(adminRoleKey, role);
      setPassword("");
    } catch (err) {
      setError(errorText(err));
    }
  }

  function logout() {
    localStorage.removeItem(adminTokenKey);
    setToken("");
    setState(null);
    setDetail(null);
  }

  async function runAction(action: () => Promise<unknown>, ok: string) {
    setError("");
    setMessage("");
    try {
      await action();
      setMessage(ok);
      await refresh();
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function selectCandidate(row: CandidateSummary) {
    setError("");
    setMessage("");
    setSelectedId(row.id);
    setDetail(await api.adminCandidate(token, row.id));
    setPreview(null);
  }

  function clearSelectedCandidate() {
    setSelectedId("");
    setDetail(null);
    setPreview(null);
    setError("");
    setMessage("");
  }

  async function openPreview(file: SubmissionFile) {
    const result = await api.fileLink(token, file.id, "preview");
    setPreview({ file, url: result.url });
  }

  async function adminConfirm() {
    if (!detail) return;
    await runAction(() => api.adminConfirm(token, detail.id), "กรรมการรับรองว่าเปิดดูได้ถูกต้องแล้ว");
  }

  async function updateCandidate(id: string, payload: { sequenceNo: number; applicantNo: string; fullName: string; note?: string }) {
    await runAction(async () => {
      const result = await api.updateCandidate(token, id, payload);
      setDetail(result.candidate);
    }, "บันทึกรายละเอียดผู้เข้าสอบแล้ว");
  }

  async function startPracticalExam() {
    const duration = state?.settings.durationSeconds || 3600;
    const mins = Math.round(duration / 60);
    await runAction(() => api.startTimer(token, duration), `เริ่มสอบปฏิบัติและนับถอยหลัง ${mins} นาทีแล้ว`);
  }

  async function stopPracticalExam() {
    const reason = window.prompt("เหตุผลการหยุดสอบ/หยุดรับงาน");
    if (reason) {
      await runAction(() => api.stopTimer(token, reason), "หยุดสอบและปิดรับงานแล้ว");
    }
  }

  async function restartPracticalExam() {
    const duration = state?.settings.durationSeconds || 3600;
    const mins = Math.round(duration / 60);
    const ok = window.confirm(`เริ่มนับถอยหลัง ${mins} นาทีใหม่หรือไม่ การเริ่มใหม่จะไม่ลบไฟล์หรือสถานะที่ส่งไว้แล้ว`);
    if (ok) {
      await runAction(() => api.startTimer(token, duration), `เริ่มนับถอยหลัง ${mins} นาทีใหม่แล้ว`);
    }
  }

  async function clearTestData() {
    const ok = window.confirm(
      "ล้างข้อมูลทดสอบทั้งหมดหรือไม่ ระบบจะลบไฟล์ upload, temp, export, backup และ reset สถานะผู้เข้าสอบ แต่จะเก็บรายชื่อผู้เข้าสอบกับ settings ไว้"
    );
    if (!ok) return;
    const confirmText = window.prompt("พิมพ์ CLEAR TEST DATA เพื่อยืนยันการล้างข้อมูลทดสอบ");
    if (confirmText !== "CLEAR TEST DATA") return;
    await runAction(
      async () => {
        await api.clearTestData(token);
        setSelectedId("");
        setDetail(null);
        setPreview(null);
      },
      "ล้างข้อมูลทดสอบและโฟลเดอร์ upload เรียบร้อยแล้ว"
    );
  }

  const reviewRows = useMemo(() => {
    const priority: Record<string, number> = {
      candidate_confirmed: 0,
      ready_to_confirm: 1,
      verifying: 2,
      uploading: 3,
      needs_resubmit: 4
    };
    return [...(state?.candidates || [])]
      .filter((row) =>
        ["candidate_confirmed", "ready_to_confirm", "verifying", "uploading", "needs_resubmit"].includes(row.status)
      )
      .sort((a, b) => (priority[a.status] ?? 9) - (priority[b.status] ?? 9) || a.sequenceNo - b.sequenceNo)
      .slice(0, 12);
  }, [state?.candidates]);

  useEffect(() => {
    if (!token) return;
    const originalTitle = "Exam Control";
    document.title = reviewRows.length ? `(${reviewRows.length}) งานรอดำเนินการ - ${originalTitle}` : originalTitle;
    return () => {
      document.title = originalTitle;
    };
  }, [reviewRows.length, token]);

  if (!token) {
    return (
      <main className="app-shell admin-login">
        <TimerPill timer={publicState?.timer} />
        <TimerNotice timer={publicState?.timer} />
        <section className="panel login-panel">
          <div className="login-icon-wrap admin-icon-wrap">
            <Lock size={32} />
          </div>
          <h1>เข้าสู่ระบบกรรมการ</h1>
          <p>ใช้รหัส admin สำหรับควบคุมระบบ หรือ read-only สำหรับดูสถานะและขึ้นจอ</p>
          <select value={role} onChange={(event) => setRole(event.target.value as "admin" | "readonly")}>
            <option value="admin">admin</option>
            <option value="readonly">read-only</option>
          </select>
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            placeholder="รหัสผ่าน"
            onKeyDown={(event) => {
              if (event.key === "Enter") login();
            }}
          />
          <button onClick={login} disabled={!password}>
            <Lock size={18} />
            เข้าสู่ระบบ
          </button>
          {error ? <p className="form-error">{error}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="admin-layout">
      <aside className="admin-sidebar">
        <div>
          <h1>Exam Control</h1>
          <p>{state?.settings.position || "ผู้ช่วยนักประชาสัมพันธ์"}</p>
        </div>
        <TimerPill timer={state?.timer} />
        <nav className="admin-nav" aria-label="Admin navigation">
          {[
            ["overview", "ภาพรวม"],
            ["candidates", "ผู้เข้าสอบ"],
            ["settings", "ตั้งค่า"],
            ["reports", "รายงาน"]
          ].map(([key, label]) => (
            <button
              key={key}
              className={adminSection === key ? "active" : ""}
              onClick={() => setAdminSection(key as AdminSection)}
              type="button"
            >
              {label}
            </button>
          ))}
          <a href="/admin/logs">Logs</a>
        </nav>
        <button className="ghost" onClick={logout} title="ออกจากระบบ">
          <LogOut size={16} />
          ออกจากระบบ
        </button>
      </aside>

      <section className="admin-main">
        <section className="admin-hero">
          <div className="admin-hero-copy">
            <img className="brand-logo admin-hero-logo" src="/municipality-logo.png" alt="โลโก้เทศบาลนครนครสวรรค์" />
            <div>
              <h1>ห้องควบคุมการสอบปฏิบัติ</h1>
              <p>{state?.settings.examTitle || "ระบบส่งผลงานสอบปฏิบัติ"} • {state?.settings.location || "เทศบาลนครนครสวรรค์"}</p>
              <small>เครดิต นักวิชาการคอมพิวเตอร์ กลุ่มงานสถิติและสารสนเทศ เทศบาลนครนครสวรรค์</small>
            </div>
          </div>
          <div className="admin-hero-actions">
            <a className="button-link ghost-link" href="/submit" target="_blank" rel="noreferrer">
              <Upload size={16} />
              ส่งงาน
            </a>
            <a className="button-link" href="/projector" target="_blank" rel="noreferrer">
              <Monitor size={16} />
              Projector
            </a>
          </div>
        </section>

        <AdminControlBar
          timer={state?.timer}
          isReadOnly={isReadOnly}
          onStart={startPracticalExam}
          onStop={stopPracticalExam}
          onRestart={restartPracticalExam}
          onExtend={() => {
            const reason = window.prompt("เหตุผลการขยายเวลา");
            if (reason) runAction(() => api.extendTimer(token, 300, reason), "ขยายเวลา 5 นาทีแล้ว");
          }}
          onExport={() => runAction(() => api.exportManifest(token), "export สำเร็จ")}
          onClear={clearTestData}
        />
        <TimerNotice timer={state?.timer} />
        <div className="sweet-alert-hint" title="คำแนะนำ: เลือกผู้สอบจากตารางเพื่อดูไฟล์ แก้ไขชื่อ หรือรับรองงาน">
          <AlertTriangle size={18} />
          <span>Hint: เลือกผู้สอบจากตารางเพื่อดูรายละเอียด แก้ไขข้อมูล และรับรองไฟล์ที่ตรวจผ่าน</span>
        </div>

        {state?.system.warnings.length ? (
          <div className="notice bad">
            <AlertTriangle size={18} />
            <span>{state.system.warnings.join(" • ")}</span>
          </div>
        ) : null}
        {message ? <div className="notice ok">{message}</div> : null}
        {error ? <div className="notice bad">{error}</div> : null}

        <section className="admin-spa-view">
          {adminSection === "overview" ? (
            <>
              <StatCards stats={state?.stats} />
              <AdminActionQueue rows={state?.candidates || []} onSelect={selectCandidate} />
              {detail ? (
                <section className="panel overview-inspector-panel">
                  <AdminInspector
                    token={token}
                    detail={detail}
                    preview={preview}
                    isReadOnly={isReadOnly}
                    onPreview={openPreview}
                    onUnlock={(reason) =>
                      detail
                        ? runAction(() => api.unlockCandidate(token, detail.id, reason), "เปิดสิทธิ์ส่งใหม่แล้ว")
                        : Promise.resolve()
                    }
                    onAdminConfirm={adminConfirm}
                    onSaveCandidate={updateCandidate}
                    onBack={clearSelectedCandidate}
                  />
                </section>
              ) : null}
            </>
          ) : null}

          {adminSection === "candidates" ? (
            <div className="admin-grid">
              <section className="panel table-panel">
                <div className="panel-heading">
                  <div>
                    <h2>สถานะผู้เข้าสอบทั้งหมด</h2>
                    <p>ข้อมูลชื่อเต็มแสดงเฉพาะหน้ากรรมการ</p>
                  </div>
                  <RefreshCw size={22} onClick={() => refresh()} />
                </div>
                <CandidateTable rows={state?.candidates || []} onSelect={selectCandidate} />
              </section>

              <section className="panel inspector-panel">
                <AdminInspector
                  token={token}
                  detail={detail}
                  preview={preview}
                  isReadOnly={isReadOnly}
                  onPreview={openPreview}
                  onUnlock={(reason) =>
                    detail
                      ? runAction(() => api.unlockCandidate(token, detail.id, reason), "เปิดสิทธิ์ส่งใหม่แล้ว")
                      : Promise.resolve()
                  }
                  onAdminConfirm={adminConfirm}
                  onSaveCandidate={updateCandidate}
                  onBack={clearSelectedCandidate}
                />
              </section>
            </div>
          ) : null}

          {adminSection === "settings" ? (
            <AdminSettingsPanel
              token={token}
              state={state}
              isReadOnly={isReadOnly}
              onDone={() => runAction(() => Promise.resolve(), "อัปเดตข้อมูลและ Gen QR code ใหม่แล้ว")}
              onError={setError}
            />
          ) : null}

          {adminSection === "reports" ? (
            <AdminReportPanel candidates={state?.candidates || []} timer={state?.timer} settings={state?.settings} />
          ) : null}
        </section>

      </section>
    </main>
  );
}

function AdminLogsPage() {
  const [token] = useState(() => localStorage.getItem(adminTokenKey) || "");
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [candidates, setCandidates] = useState<CandidateSummary[]>([]);
  const [filters, setFilters] = useState<AuditLogFilters>({ limit: 250 });
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!token) return;
    const [state, logResult] = await Promise.all([api.adminState(token), api.auditLogs(token, filters)]);
    setCandidates(state.candidates);
    setLogs(logResult.logs);
  }, [token, filters]);

  useEffect(() => {
    refresh().catch((err) => setError(errorText(err)));
  }, [refresh]);

  if (!token) {
    return (
      <main className="app-shell admin-login">
        <section className="panel login-panel">
          <div className="login-icon-wrap admin-icon-wrap">
            <Lock size={32} />
          </div>
          <h1>Activity Logs</h1>
          <p>กรุณาเข้าสู่ระบบแอดมินก่อนเปิดหน้าบันทึกกิจกรรม</p>
          <a className="button-link" href="/admin">
            <Lock size={18} />
            เข้าสู่ระบบแอดมิน
          </a>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell admin-logs-page">
      <div className="log-page-nav">
        <a className="button-link ghost-link" href="/admin">
          <Monitor size={16} />
          กลับหน้าแอดมิน
        </a>
      </div>
      {error ? <div className="notice bad">{error}</div> : null}
      <AuditLogsPanel
        logs={logs}
        filters={filters}
        candidates={candidates}
        onFiltersChange={setFilters}
        onRefresh={() => refresh()}
      />
    </main>
  );
}

function ProjectorPage() {
  const [state, setState] = useState<PublicState | null>(null);
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const [monitorMode, setMonitorMode] = useState<ProjectorMonitorMode>(() =>
    new URLSearchParams(window.location.search).get("view") === "ticker" ? "ticker" : "grid"
  );

  const refresh = useCallback(async () => {
    setState(await api.publicState());
  }, []);

  useEffect(() => {
    refresh().catch(() => undefined);
    const id = window.setInterval(() => refresh().catch(() => undefined), 1000);
    return () => window.clearInterval(id);
  }, [refresh]);
  useRealtime(() => refresh().catch(() => undefined));

  const settings = state?.settings;
  const rows = state?.candidates || [];
  const remainingSeconds = useCountdownSeconds(state?.timer);
  const confirmedCount = useMemo(
    () => rows.filter((row) => ["candidate_confirmed", "admin_confirmed", "confirmed"].includes(row.status)).length,
    [rows]
  );
  const activeCount = useMemo(
    () => rows.filter((row) => ["uploading", "verifying", "ready_to_confirm"].includes(row.status)).length,
    [rows]
  );
  const confirmedPct = rows.length ? Math.round((confirmedCount / rows.length) * 100) : 0;
  const readyCount = state?.stats?.ready_to_confirm || 0;
  const unconfirmedCount = Math.max(0, rows.length - confirmedCount);
  const candidateConfirmedCount = rows.filter((row) => Boolean(row.candidateConfirmedAt || row.status === "candidate_confirmed" || row.status === "confirmed")).length;
  const adminConfirmedCount = rows.filter((row) => Boolean(row.adminConfirmedAt || row.status === "admin_confirmed" || row.status === "confirmed")).length;
  const projectorTimerNotice = timerNotice(state?.timer, remainingSeconds);

  return (
    <main className="projector">
      <header className="projector-header">
        <div className="projector-title-group">
          <img className="brand-logo projector-brand-logo" src="/municipality-logo.png" alt="โลโก้เทศบาลนครนครสวรรค์" />
          <div className="projector-title-mark" aria-hidden="true" />
          <div>
          <h1>{settings?.examTitle || "ระบบส่งผลงานสอบปฏิบัติ"}</h1>
          <p>
            {settings?.organization} • {settings?.location}
          </p>
          </div>
        </div>
        <div className={`projector-clock ${projectorTimerNotice?.tone === "bad" ? "ended" : ""}`}>
          <span>{projectorTimerNotice?.title || "เวลาคงเหลือ"}</span>
          <strong>{formatSeconds(remainingSeconds)}</strong>
        </div>
        <nav className="projector-nav" aria-label="Projector navigation">
          <a href="/projector" title="แดชบอร์ดภาพรวมสำหรับจอหลัก">Dashboard</a>
          <a href="/projector?view=ticker" title="เปิดอักษรวิ่งสองแถว">Ticker</a>
          <a href="/submit" title="เปิดหน้าส่งผลงาน">Submit</a>
          <a href="/admin" title="กลับไปหน้าควบคุมแอดมิน">Admin</a>
        </nav>
      </header>
      <section className="projector-body">
        <div className="projector-info" aria-label="ภาพรวมสถานะระบบส่งผลงาน">
          <ProjectorInsightsPanel rows={rows} timer={state?.timer} remainingSeconds={remainingSeconds} />
          <ProjectorConfirmationPanel
            confirmedCount={confirmedCount}
            confirmedPct={confirmedPct}
            readyCount={readyCount}
            unconfirmedCount={unconfirmedCount}
            candidateConfirmedCount={candidateConfirmedCount}
            adminConfirmedCount={adminConfirmedCount}
          />
          <ProjectorLegend />
        </div>

        <div className="projector-progress" aria-label="สถานะการส่งผลงานของผู้เข้าสอบ">
          <div className="projector-progress-head">
            <div>
              <h2>ติดตามการส่งผลงานแบบเรียลไทม์</h2>
              <p className="projector-live-summary">
                ผู้สอบยืนยัน {candidateConfirmedCount}/{rows.length} • กรรมการรับรอง {adminConfirmedCount}/{rows.length} • กำลังดำเนินการ {activeCount}
              </p>
              <p className="projector-old-summary">
                {confirmedCount}/{rows.length} confirmed • {activeCount} active • {unconfirmedCount} remaining
              </p>
            </div>
            <div className="projector-monitor-actions">
              <div className="projector-view-switch" aria-label="เลือกมุมมองสถานะ">
                <button className={monitorMode === "grid" ? "active" : ""} onClick={() => setMonitorMode("grid")}>ตาราง</button>
                <button className={monitorMode === "ticker" ? "active" : ""} onClick={() => setMonitorMode("ticker")}>อักษรวิ่ง</button>
              </div>
              <div className="projector-progress-total">
                <strong>{confirmedPct}%</strong>
                <span>เสร็จสมบูรณ์</span>
              </div>
            </div>
          </div>
          <div className="projector-progress-bar" aria-hidden="true">
            <div style={{ width: `${confirmedPct}%` }} />
          </div>
          {monitorMode === "ticker" ? <ProjectorHorizontalTicker rows={rows} /> : <ProjectorCompactGrid rows={rows} />}
        </div>

        <aside className="projector-qr-panel" aria-label="QR code สำหรับส่งผลงาน">
          <ProjectorQrPanel
            systemUrlQr={state?.systemUrlQr}
            publicUrl={settings?.publicUrl}
            onOpenFallback={() => setFallbackOpen(true)}
          />
        </aside>
      </section>

      <section className="projector-bottom-bar" aria-label="สรุปสถานะและ QR code">
        <ProjectorSummaryBar stats={state?.stats} />
      </section>
      {fallbackOpen ? <ProjectorFallbackModal onClose={() => setFallbackOpen(false)} /> : null}
    </main>
  );
}

function ProjectorSummaryBar({ stats }: { stats?: Record<string, number> }) {
  const value = (key: string) => stats?.[key] || 0;
  const items = [
    { label: "ทั้งหมด", value: value("total"), tone: "slate" },
    { label: "ยังไม่เริ่ม", value: value("not_started"), tone: "slate" },
    { label: "กำลังส่ง", value: value("uploading"), tone: "orange" },
    { label: "กำลังตรวจ", value: value("verifying"), tone: "cyan" },
    { label: "รอยืนยัน", value: value("ready_to_confirm"), tone: "violet" },
    { label: "ยืนยันแล้ว", value: value("candidate_confirmed") + value("admin_confirmed") + value("confirmed"), tone: "emerald" },
    { label: "ต้องส่งใหม่", value: value("needs_resubmit"), tone: "rose" },
    { label: "เปิดสิทธิ์ใหม่", value: value("admin_unlocked"), tone: "blue" }
  ] as const;

  return (
    <div className="projector-summary-strip">
      {items.map((item) => (
        <div className={`projector-summary-item ${item.tone}`} key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

function ProjectorOperationsPanel({ stats, total }: { stats?: Record<string, number>; total: number }) {
  const value = (key: string) => stats?.[key] || 0;
  const items = [
    { key: "total", label: "ผู้เข้าสอบทั้งหมด", value: value("total") || total, tone: "slate" },
    { key: "not_started", label: "ยังไม่เริ่มส่ง", value: value("not_started"), tone: "slate" },
    { key: "uploading", label: "กำลังอัปโหลด", value: value("uploading"), tone: "orange" },
    { key: "verifying", label: "กำลังตรวจไฟล์", value: value("verifying"), tone: "cyan" },
    { key: "ready", label: "รอผู้สอบยืนยัน", value: value("ready_to_confirm"), tone: "violet" },
    { key: "confirmed", label: "ยืนยันครบแล้ว", value: value("candidate_confirmed") + value("admin_confirmed") + value("confirmed"), tone: "emerald" },
    { key: "resubmit", label: "ต้องส่งใหม่", value: value("needs_resubmit"), tone: "rose" },
    { key: "unlocked", label: "เปิดสิทธิ์ใหม่", value: value("admin_unlocked"), tone: "blue" }
  ];

  return (
    <section className="projector-ops-card">
      <div className="projector-section-kicker">ภาพรวมสถานะ</div>
      <h2>ภาพรวมการส่งผลงาน</h2>
      <div className="projector-status-list">
        {items.map((item) => (
          <div className={`projector-status-row ${item.tone}`} key={item.key}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProjectorInsightsPanel({
  rows,
  timer,
  remainingSeconds
}: {
  rows: CandidateSummary[];
  timer?: PublicState["timer"] | null;
  remainingSeconds: number;
}) {
  const total = rows.length;
  const started = rows.filter((row) => row.status !== "not_started").length;
  const uploaded = rows.filter((row) =>
    ["ready_to_confirm", "candidate_confirmed", "admin_confirmed", "confirmed"].includes(row.status)
  ).length;
  const attention = rows.filter((row) => row.status === "needs_resubmit" || row.status === "admin_unlocked" || Boolean(row.errorMessage)).length;
  const waiting = rows.filter((row) => row.status === "not_started").length;
  const active = rows.filter((row) => ["uploading", "verifying"].includes(row.status)).length;
  const duration = timer?.durationSeconds || 0;
  const elapsed = timer?.state === "running" && duration ? Math.max(0, duration - remainingSeconds) : timer?.state === "ended" ? duration : 0;
  const elapsedPct = duration ? Math.min(100, Math.round((elapsed / duration) * 100)) : 0;
  const bars = [
    { label: "เริ่มดำเนินการ", value: started, pct: percent(started, total), tone: "blue" },
    { label: "ไฟล์ผ่านตรวจ", value: uploaded, pct: percent(uploaded, total), tone: "emerald" },
    { label: "กำลังอัปโหลด/ตรวจ", value: active, pct: percent(active, total), tone: "cyan" },
    { label: "ต้องติดตาม", value: attention, pct: percent(attention, total), tone: "rose" }
  ];

  return (
    <section className="projector-ops-card projector-insights-card">
      <div className="projector-section-kicker">Insight Data</div>
      <h2>สัญญาณหน้างาน</h2>
      <div className="projector-insight-hero">
        <div>
          <span>ยังไม่เริ่ม</span>
          <strong>{waiting}</strong>
          <small>จาก {total} คน</small>
        </div>
        <div>
          <span>เวลาที่ใช้ไป</span>
          <strong>{elapsedPct}%</strong>
          <small>{timer?.state === "running" ? "กำลังสอบ" : timer?.state === "ended" ? "สิ้นสุดแล้ว" : "ยังไม่เริ่ม"}</small>
        </div>
      </div>
      <div className="projector-insight-bars">
        {bars.map((bar) => (
          <div className={`projector-insight-bar ${bar.tone}`} key={bar.label}>
            <span>{bar.label}</span>
            <strong>{bar.value}</strong>
            <i aria-hidden="true"><b style={{ width: `${bar.pct}%` }} /></i>
          </div>
        ))}
      </div>
    </section>
  );
}

function percent(value: number, total: number) {
  return total ? Math.round((value / total) * 100) : 0;
}

function ProjectorConfirmationPanel({
  confirmedCount,
  confirmedPct,
  readyCount,
  unconfirmedCount,
  candidateConfirmedCount,
  adminConfirmedCount
}: {
  confirmedCount: number;
  confirmedPct: number;
  readyCount: number;
  unconfirmedCount: number;
  candidateConfirmedCount: number;
  adminConfirmedCount: number;
}) {
  return (
    <section className="projector-confirm-card">
      <div>
        <div className="projector-section-kicker">การยืนยัน</div>
        <h2>ยืนยันผลงาน</h2>
      </div>
      <div className="projector-confirm-meter">
        <strong>{confirmedPct}%</strong>
        <span>ยืนยันแล้ว</span>
        <div aria-hidden="true">
          <i style={{ width: `${confirmedPct}%` }} />
        </div>
      </div>
      <div className="projector-confirm-grid">
        <div>
          <span>ผู้สอบ</span>
          <strong>{candidateConfirmedCount}</strong>
        </div>
        <div>
          <span>กรรมการ</span>
          <strong>{adminConfirmedCount}</strong>
        </div>
        <div>
          <span>รวมเสร็จ</span>
          <strong>{confirmedCount}</strong>
        </div>
        <div>
          <span>รอยืนยัน</span>
          <strong>{readyCount}</strong>
        </div>
        <div>
          <span>คงเหลือ</span>
          <strong>{unconfirmedCount}</strong>
        </div>
      </div>
    </section>
  );
}

function ProjectorLegend() {
  const items = [
    ["not_started", "รอ"],
    ["uploading", "ส่งไฟล์"],
    ["verifying", "ตรวจไฟล์"],
    ["ready_to_confirm", "รอยืนยัน"],
    ["confirmed", "ยืนยันแล้ว"],
    ["needs_resubmit", "ต้องแก้ไข"]
  ] as const;
  return (
    <section className="projector-legend-card" aria-label="คำอธิบายสีสถานะ">
      {items.map(([status, label]) => (
        <div className={`projector-legend-item ${statusTone(status)}`} key={status}>
          <i aria-hidden="true" />
          <span>{label}</span>
        </div>
      ))}
    </section>
  );
}

function ProjectorQrPanel({
  systemUrlQr,
  publicUrl,
  onOpenFallback
}: {
  systemUrlQr?: string;
  publicUrl?: string;
  onOpenFallback: () => void;
}) {
  return (
    <div className="projector-qr-shell">
      <div className="projector-section-kicker">Main Submission QR</div>
      <h2>ส่งผลงานระบบหลัก</h2>
      <div className="projector-main-qr">
        {systemUrlQr ? <img src={systemUrlQr} alt="QR URL ระบบส่งผลงาน" /> : <div className="qr-placeholder">QR</div>}
      </div>
      <div className="projector-url-box">
        <QrCode size={16} />
        <span>{publicUrl || "-"}</span>
      </div>
      <button className="projector-fallback-button" onClick={onOpenFallback}>
        <AlertTriangle size={15} />
        Backup Drive
      </button>
    </div>
  );
}

function ProjectorFallbackModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="projector-fallback-backdrop" role="dialog" aria-modal="true" aria-label="ช่องทางสำรอง Google Drive">
      <div className="projector-fallback-modal">
        <div className="projector-fallback-head">
          <div>
            <div className="projector-section-kicker">Emergency Upload Channel</div>
            <h2>Google Drive สำรอง</h2>
          </div>
          <button className="projector-fallback-close" onClick={onClose} aria-label="ปิดหน้าต่างช่องทางสำรอง">
            <Square size={14} />
          </button>
        </div>
        <p>
          ช่องทางสำรองสำหรับกรณีระบบหลักขัดข้องเท่านั้น กรุณาใช้งานเมื่อกรรมการแจ้งให้ใช้
        </p>
        <div className="projector-fallback-content">
          <div className="projector-fallback-qr">
            <img src={qrImageSrc(googleDriveFallbackUrl, 260)} alt="QR Google Drive สำรอง" />
            <span>สแกนเพื่อเปิด Google Drive</span>
          </div>
          <div className="projector-fallback-copy">
            <a href={googleDriveFallbackUrl} target="_blank" rel="noreferrer">
              {googleDriveFallbackUrl}
            </a>
            <small>กรณีใช้ช่องทางสำรอง ให้ตั้งชื่อไฟล์ด้วยลำดับหรือเลขประจำตัวสอบก่อนอัปโหลด</small>
          </div>
        </div>
      </div>
    </div>
  );
}

function isProjectorView(value: string | null): value is ProjectorView {
  return value === "grid" || value === "table" || value === "cards" || value === "vertical" || value === "horizontal";
}

function ProjectorProgressView({ rows, view }: { rows: CandidateSummary[]; view: ProjectorView }) {
  if (view === "table") return <ProjectorTable rows={rows} />;
  if (view === "cards") return <ProjectorCards rows={rows} />;
  if (view === "vertical") return <ProjectorVerticalTicker rows={rows} />;
  if (view === "horizontal") return <ProjectorHorizontalTicker rows={rows} />;
  return <ProjectorGrid rows={rows} />;
}

function ProjectorGrid({ rows }: { rows: CandidateSummary[] }) {
  return (
    <div className="projector-grid">
      {rows.map((row) => (
        <ProjectorCell row={row} key={row.id} />
      ))}
    </div>
  );
}

function ProjectorCompactGrid({ rows }: { rows: CandidateSummary[] }) {
  return (
    <div className="projector-compact-grid">
      {rows.map((row) => (
        <ProjectorCompactCell row={row} key={row.id} />
      ))}
    </div>
  );
}

function ProjectorCompactCell({ row }: { row: CandidateSummary }) {
  const candidateConfirmed = Boolean(row.candidateConfirmedAt || row.status === "candidate_confirmed" || row.status === "confirmed");
  const adminConfirmed = Boolean(row.adminConfirmedAt || row.status === "admin_confirmed" || row.status === "confirmed");
  const warning = row.status === "needs_resubmit" || Boolean(row.errorMessage);
  return (
    <div className={`projector-compact-cell ${statusTone(row.status)}`}>
      <strong>{String(row.sequenceNo).padStart(2, "0")}</strong>
      <span>{row.applicantNo}</span>
      <em>{projectorShortStatus(row)}</em>
      <small>
        {row.status === "uploading" ? `${Math.round(row.progress || 0)}%` : warning ? "!" : (
          <>
            <b className={candidateConfirmed ? "on" : ""}>ผ</b>
            <b className={adminConfirmed ? "on" : ""}>ก</b>
          </>
        )}
      </small>
    </div>
  );
}

function projectorShortStatus(row: CandidateSummary) {
  if (row.status === "uploading") return `${Math.round(row.progress)}%`;
  const map: Partial<Record<CandidateSummary["status"], string>> = {
    not_started: "รอ",
    verifying: "ตรวจ",
    ready_to_confirm: "ยืนยัน",
    candidate_confirmed: "ส่งแล้ว",
    admin_confirmed: "รับรอง",
    confirmed: "เสร็จ",
    needs_resubmit: "แก้ไข",
    expired: "หมดเวลา",
    admin_unlocked: "เปิดใหม่"
  };
  return map[row.status] || statusLabel(row.status);
}

function ProjectorCell({ row }: { row: CandidateSummary }) {
  return (
    <div className={`projector-cell ${statusTone(row.status)}`}>
      <strong>{String(row.sequenceNo).padStart(2, "0")}</strong>
      <span>{row.applicantNo}</span>
      <em>{statusLabel(row.status)}</em>
    </div>
  );
}

function ProjectorTable({ rows }: { rows: CandidateSummary[] }) {
  const midpoint = Math.ceil(rows.length / 2);
  const groups = [rows.slice(0, midpoint), rows.slice(midpoint)];
  return (
    <div className="projector-table-view">
      {groups.map((group, index) => (
        <table key={index}>
          <thead>
            <tr>
              <th>ลำดับ</th>
              <th>เลขผู้สมัคร</th>
              <th>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {group.map((row) => (
              <tr className={statusTone(row.status)} key={row.id}>
                <td>{String(row.sequenceNo).padStart(2, "0")}</td>
                <td>{row.applicantNo}</td>
                <td>{statusLabel(row.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}

function ProjectorCards({ rows }: { rows: CandidateSummary[] }) {
  return (
    <div className="projector-card-view">
      {rows.map((row) => (
        <article className={`projector-person-card ${statusTone(row.status)}`} key={row.id}>
          <div>
            <strong>{String(row.sequenceNo).padStart(2, "0")}</strong>
            <span>{row.applicantNo}</span>
          </div>
          <p>ลำดับ {String(row.sequenceNo).padStart(2, "0")}</p>
          <em>{statusLabel(row.status)}</em>
        </article>
      ))}
    </div>
  );
}

function ProjectorVerticalTicker({ rows }: { rows: CandidateSummary[] }) {
  const tickerRows = rows.length > 0 ? [...rows, ...rows] : [];
  return (
    <div className="projector-ticker vertical" aria-label="Vertical candidate progress ticker">
      <div className="projector-ticker-track">
        {tickerRows.map((row, index) => (
          <ProjectorTickerRow row={row} key={`${row.id}-${index}`} />
        ))}
      </div>
    </div>
  );
}

function ProjectorHorizontalTicker({ rows }: { rows: CandidateSummary[] }) {
  const firstLane = rows.filter((_, index) => index % 2 === 0);
  const secondLane = rows.filter((_, index) => index % 2 === 1);
  const lanes = [firstLane, secondLane].map((lane) => (lane.length > 0 ? [...lane, ...lane] : []));
  return (
    <div className="projector-ticker horizontal" aria-label="Horizontal candidate progress ticker">
      {lanes.map((tickerRows, laneIndex) => (
        <div className="projector-ticker-lane" key={laneIndex}>
          <div className="projector-ticker-track">
            {tickerRows.map((row, index) => (
              <ProjectorTickerChip row={row} key={`${row.id}-${laneIndex}-${index}`} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProjectorTickerRow({ row }: { row: CandidateSummary }) {
  const candidateConfirmed = Boolean(row.candidateConfirmedAt || row.status === "candidate_confirmed" || row.status === "confirmed");
  const adminConfirmed = Boolean(row.adminConfirmedAt || row.status === "admin_confirmed" || row.status === "confirmed");
  return (
    <div className={`projector-ticker-row ${statusTone(row.status)}`}>
      <strong>{String(row.sequenceNo).padStart(2, "0")}</strong>
      <span>{row.applicantNo}</span>
      <em>{row.status === "uploading" ? `${Math.round(row.progress)}%` : statusLabel(row.status)}</em>
      <small>ผู้สอบ {candidateConfirmed ? "ยืนยัน" : "-"} • กรรมการ {adminConfirmed ? "รับรอง" : "-"}</small>
    </div>
  );
}

function ProjectorTickerChip({ row }: { row: CandidateSummary }) {
  const candidateConfirmed = Boolean(row.candidateConfirmedAt || row.status === "candidate_confirmed" || row.status === "confirmed");
  const adminConfirmed = Boolean(row.adminConfirmedAt || row.status === "admin_confirmed" || row.status === "confirmed");
  return (
    <div className={`projector-ticker-chip ${statusTone(row.status)}`}>
      <strong>{String(row.sequenceNo).padStart(2, "0")}</strong>
      <span>{row.applicantNo}</span>
      <em>{statusLabel(row.status)}</em>
      <small>ผู้สอบ {candidateConfirmed ? "✓" : "-"} / กรรมการ {adminConfirmed ? "✓" : "-"}</small>
    </div>
  );
}

function TimerControlPanel({
  timer,
  isReadOnly,
  onStart,
  onStop,
  onRestart
}: {
  timer?: AdminState["timer"] | null;
  isReadOnly: boolean;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onRestart: () => Promise<void>;
}) {
  const isRunning = timer?.state === "running" && (timer.remainingSeconds || 0) > 0;
  return (
    <div className="exam-controls" aria-label="ควบคุมเวลาสอบปฏิบัติ">
      <button className="start-exam" disabled={isReadOnly || isRunning} onClick={onStart}>
        <Play size={16} />
        เริ่มสอบปฏิบัติ
      </button>
      <button className="stop-exam" disabled={isReadOnly || !isRunning} onClick={onStop}>
        <Square size={15} />
        หยุด
      </button>
      <button className="restart-exam" disabled={isReadOnly} onClick={onRestart}>
        <RotateCcw size={16} />
        เริ่มใหม่
      </button>
    </div>
  );
}

function TimerPill({ timer }: { timer?: PublicState["timer"] | AdminState["timer"] | null }) {
  const remainingSeconds = useCountdownSeconds(timer);
  const isRunning = timer?.state === "running";
  const ended = timer?.state === "ended" || (isRunning && remainingSeconds <= 0);
  const notice = timerNotice(timer, remainingSeconds);
  return (
    <div className={`timer-pill ${isRunning ? "running" : ""} ${ended ? "ended" : ""} ${notice?.tone === "bad" ? "urgent" : ""}`}>
      {isRunning && !ended ? <span className="timer-pulse" aria-hidden="true" /> : null}
      <Clock size={20} />
      <span>{ended ? "หมดเวลาสอบแล้ว" : isRunning ? "กำลังสอบ" : "ยังไม่เริ่ม"}</span>
      <strong>{formatSeconds(remainingSeconds)}</strong>
    </div>
  );
}

function TimerNotice({
  timer,
  className = ""
}: {
  timer?: PublicState["timer"] | AdminState["timer"] | null;
  className?: string;
}) {
  const remainingSeconds = useCountdownSeconds(timer);
  const notice = timerNotice(timer, remainingSeconds);
  if (!notice) return null;
  return (
    <div className={`notice timer-alert ${notice.tone} ${className}`}>
      {notice.tone === "bad" ? <AlertTriangle size={18} /> : <Bell size={18} />}
      <span>
        <strong>{notice.title}</strong> {notice.detail}
      </span>
    </div>
  );
}

function StatusBadge({ status, progress = 0 }: { status: CandidateSummary["status"]; progress?: number }) {
  return (
    <span className={`status-badge ${statusTone(status)}`}>
      {statusLabel(status)}
      {status === "uploading" ? ` ${Math.round(progress)}%` : ""}
    </span>
  );
}

type ReportDimension = "status" | "confirmation" | "verification" | "risk";
type ReportFocus = "all" | "pending" | "ready" | "risk";

function AdminReportPanel({
  candidates,
  timer,
  settings
}: {
  candidates: CandidateSummary[];
  timer?: AdminState["timer"] | null;
  settings?: AdminState["settings"];
}) {
  const [dimension, setDimension] = useState<ReportDimension>("status");
  const [focus, setFocus] = useState<ReportFocus>("all");

  const rows = useMemo(
    () =>
      candidates.map((row) => {
        const candidateConfirmed = Boolean(row.candidateConfirmedAt || row.status === "candidate_confirmed" || row.status === "confirmed");
        const adminConfirmed = Boolean(row.adminConfirmedAt || row.status === "admin_confirmed" || row.status === "confirmed");
        const ready = row.status === "ready_to_confirm";
        const risk = row.status === "needs_resubmit" || Boolean(row.errorMessage);
        return {
          ...row,
          candidateConfirmed,
          adminConfirmed,
          ready,
          risk,
          confirmationState: candidateConfirmed && adminConfirmed ? "ครบทั้งสองฝ่าย" : candidateConfirmed ? "ผู้สอบยืนยันแล้ว" : adminConfirmed ? "กรรมการรับรองแล้ว" : ready ? "รอผู้สอบยืนยัน" : "ยังไม่ยืนยัน",
          verificationState: risk ? "ต้องแก้ไข/ส่งใหม่" : ["ready_to_confirm", "candidate_confirmed", "admin_confirmed", "confirmed"].includes(row.status) ? "ไฟล์ผ่านการตรวจ" : row.status === "verifying" ? "กำลังตรวจไฟล์" : row.status === "uploading" ? "กำลังอัปโหลด" : "ยังไม่มีไฟล์ผ่านตรวจ"
        };
      }),
    [candidates]
  );

  const filteredRows = useMemo(() => {
    if (focus === "pending") return rows.filter((row) => !row.candidateConfirmed || !row.adminConfirmed);
    if (focus === "ready") return rows.filter((row) => row.ready || (row.candidateConfirmed && !row.adminConfirmed));
    if (focus === "risk") return rows.filter((row) => row.risk || row.status === "admin_unlocked");
    return rows;
  }, [focus, rows]);

  const breakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of filteredRows) {
      const key =
        dimension === "confirmation"
          ? row.confirmationState
          : dimension === "verification"
            ? row.verificationState
            : dimension === "risk"
              ? row.risk
                ? "ต้องส่งใหม่/มีข้อผิดพลาด"
                : row.status === "admin_unlocked"
                  ? "เปิดสิทธิ์ใหม่"
                  : "ปกติ"
              : statusLabel(row.status);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [dimension, filteredRows]);

  const candidateConfirmedCount = rows.filter((row) => row.candidateConfirmed).length;
  const adminConfirmedCount = rows.filter((row) => row.adminConfirmed).length;
  const readyForAdmin = rows.filter((row) => row.candidateConfirmed && !row.adminConfirmed).length;
  const riskCount = rows.filter((row) => row.risk).length;

  function exportReportCsv() {
    const header = [
      "ลำดับ",
      "เลขประจำตัวสอบ",
      "ชื่อ-สกุล",
      "สถานะระบบ",
      "ความคืบหน้า",
      "สถานะตรวจไฟล์",
      "ผู้สอบยืนยัน",
      "กรรมการรับรอง",
      "สถานะยืนยัน",
      "หมายเหตุ"
    ];
    const body = filteredRows.map((row) => [
      row.sequenceNo,
      row.applicantNo,
      row.fullName || "",
      statusLabel(row.status),
      `${Math.round(row.progress || 0)}%`,
      row.verificationState,
      row.candidateConfirmed ? "ยืนยันแล้ว" : "ยังไม่ยืนยัน",
      row.adminConfirmed ? "รับรองแล้ว" : "ยังไม่รับรอง",
      row.confirmationState,
      row.errorMessage || ""
    ]);
    downloadCsv(`smart-submission-report-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`, [header, ...body]);
  }

  function printReportPdf() {
    const title = "รายงานผลการส่งผลงานสอบปฏิบัติ";
    const generatedAt = displayDateTime(new Date().toISOString());
    const organization = settings?.organization || "หน่วยงานจัดสอบ";
    const examTitle = settings?.examTitle || "การสอบปฏิบัติ";
    const location = settings?.location || "-";
    const rowsHtml = filteredRows
      .map(
        (row) => `
          <tr>
            <td>${escapeHtml(row.sequenceNo)}</td>
            <td>${escapeHtml(row.applicantNo)}</td>
            <td>${escapeHtml(row.fullName || "")}</td>
            <td>${escapeHtml(statusLabel(row.status))}</td>
            <td>${escapeHtml(`${Math.round(row.progress || 0)}%`)}</td>
            <td>${escapeHtml(row.verificationState)}</td>
            <td>${escapeHtml(row.candidateConfirmed ? "ยืนยันแล้ว" : "-")}</td>
            <td>${escapeHtml(row.adminConfirmed ? "รับรองแล้ว" : "-")}</td>
            <td>${escapeHtml(row.errorMessage || "")}</td>
          </tr>`
      )
      .join("");
    const kpis = [
      ["ผู้สอบยืนยัน", candidateConfirmedCount],
      ["กรรมการรับรอง", adminConfirmedCount],
      ["รอกรรมการ", readyForAdmin],
      ["ต้องติดตาม", riskCount]
    ];
    const win = window.open("", "_blank", "width=1200,height=800");
    if (!win) return;
    win.document.write(`<!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${title}</title>
          <style>
            @page { size: A4 landscape; margin: 12mm; }
            * { box-sizing: border-box; }
            body { margin: 0; font-family: "Sarabun", "Noto Sans Thai", "Prompt", sans-serif; color: #111827; background: #fff; }
            .sheet { min-height: 100vh; padding: 0; }
            header { display: grid; grid-template-columns: 72px minmax(0, 1fr) 220px; gap: 16px; align-items: center; border-bottom: 2px solid #111827; padding-bottom: 12px; margin-bottom: 12px; }
            header img { width: 64px; height: 64px; object-fit: contain; }
            h1 { margin: 0; font-size: 24px; text-align: center; line-height: 1.25; }
            h2 { margin: 4px 0 0; font-size: 16px; text-align: center; font-weight: 700; }
            p { margin: 3px 0 0; color: #374151; font-weight: 700; }
            .meta { text-align: right; font-size: 11px; }
            .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; }
            .kpi { border: 1px solid #9ca3af; padding: 8px 10px; background: #f9fafb; }
            .kpi span { display: block; color: #374151; font-size: 11px; font-weight: 700; }
            .kpi strong { display: block; margin-top: 3px; font-size: 24px; line-height: 1; }
            table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
            th { background: #e5e7eb; color: #111827; text-align: left; padding: 6px; border: 1px solid #9ca3af; }
            td { border: 1px solid #d1d5db; padding: 5px 6px; vertical-align: top; }
            tr:nth-child(even) td { background: #f9fafb; }
            .signatures { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 22px; page-break-inside: avoid; }
            .signature { text-align: center; min-height: 72px; padding-top: 34px; color: #111827; font-size: 12px; }
            .signature .line { border-top: 1px solid #111827; padding-top: 7px; }
            .signature small { display: block; margin-top: 4px; color: #4b5563; }
            footer { margin-top: 10px; color: #4b5563; font-size: 10px; font-weight: 700; }
            @media print { body { background: #fff; } .sheet { padding: 0; } }
          </style>
        </head>
        <body>
          <main class="sheet">
            <header>
              <img src="/municipality-logo.png" alt="" />
              <div>
                <h1>${title}</h1>
                <h2>${escapeHtml(examTitle)}</h2>
                <p>${escapeHtml(organization)} • สถานที่ ${escapeHtml(location)}</p>
              </div>
              <div class="meta">
                <p>สร้างเมื่อ ${generatedAt}</p>
                <p>จำนวน ${filteredRows.length} รายการ จากผู้เข้าสอบทั้งหมด ${rows.length} คน</p>
              </div>
            </header>
            <section class="kpis">
              ${kpis.map(([label, value]) => `<div class="kpi"><span>${label}</span><strong>${value}</strong></div>`).join("")}
            </section>
            <table>
              <thead>
                <tr>
                  <th>ลำดับ</th><th>เลขสอบ</th><th>ชื่อ-นามสกุล</th><th>สถานะ</th><th>คืบหน้า</th><th>ตรวจไฟล์</th><th>ผู้สอบ</th><th>กรรมการ</th><th>หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
            <section class="signatures">
              ${[1, 2, 3].map((item) => `
                <div class="signature">
                  <div class="line">(ลงชื่อ) ................................................</div>
                  <small>กรรมการตรวจรับรองผลงาน คนที่ ${item}</small>
                </div>
              `).join("")}
            </section>
            <footer>บันทึกเป็น PDF: เลือกเครื่องพิมพ์ "Save as PDF" หรือ "Microsoft Print to PDF"</footer>
          </main>
        </body>
      </html>`);
    win.document.close();
    win.focus();
    window.setTimeout(() => win.print(), 300);
  }

  function printCandidateCards() {
    const sortedRows = [...filteredRows].sort((a, b) => a.sequenceNo - b.sequenceNo);
    const publicUrl = settings?.publicUrl || window.location.origin;
    const wifiQr = settings?.wifiQrAvailable ? "/files/wifi-qr" : "";
    const wifiSsid = settings?.wifiSsid || "@Communication";
    const wifiPassword = settings?.wifiPassword || "VoIPvy,ibomiN";
    const cardsHtml = sortedRows
      .map((row) => {
        const submitUrl = candidateSubmitUrl(publicUrl, row.applicantNo);
        return `
          <article class="seat-card">
            <div class="qr-block">
              <img src="${qrImageSrc(submitUrl, 220)}" alt="QR ส่งงาน" />
              <span>QR ส่งงาน</span>
            </div>
            <div class="candidate-info">
              <small>ลำดับที่</small>
              <strong>${escapeHtml(String(row.sequenceNo).padStart(2, "0"))}</strong>
              <b>${escapeHtml(row.applicantNo)}</b>
              <p>${escapeHtml(row.fullName || "")}</p>
            </div>
            <div class="qr-block wifi">
              ${wifiQr ? `<img src="${wifiQr}" alt="QR Wi-Fi" />` : `<div class="qr-missing">Wi-Fi</div>`}
              <span>QR Wi-Fi</span>
            </div>
            <div class="card-instructions">
              <b>QR ส่งงาน:</b> 1. สแกน 2. อัปโหลดไฟล์ 3. เปิดดูตัวอย่างแล้วกดยืนยัน จากนั้นบันทึกหลักฐานได้
              <br />
              <b>Wi-Fi:</b> ${escapeHtml(wifiSsid)} / รหัส ${escapeHtml(wifiPassword)} ใช้กล้องมือถือสแกน QR ไม่ควรสแกนผ่าน LINE
            </div>
          </article>`;
      })
      .join("");
    const win = window.open("", "_blank", "width=1100,height=800");
    if (!win) return;
    win.document.write(`<!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>บัตร QR ประจำโต๊ะผู้เข้าสอบ</title>
          <style>
            @page { size: A4 portrait; margin: 9mm; }
            * { box-sizing: border-box; }
            body { margin: 0; font-family: "Prompt", "Sarabun", "Noto Sans Thai", sans-serif; color: #14213d; background: #f8fafc; }
            .sheet { display: grid; grid-template-columns: repeat(2, 88mm); gap: 6mm; align-content: start; justify-content: center; padding: 0; }
            .seat-card { width: 88mm; min-height: 66mm; display: grid; grid-template-columns: 23mm minmax(0, 1fr) 23mm; gap: 3mm 6mm; align-items: center; padding: 4mm; break-inside: avoid; border: 1.2px solid #94a3b8; border-radius: 3mm; background: #fff; }
            .qr-block { display: grid; gap: 1.4mm; justify-items: center; align-content: center; }
            .qr-block img, .qr-missing { width: 22mm; height: 22mm; object-fit: contain; border: 1px solid #e2e8f0; border-radius: 1mm; background: #fff; }
            .qr-missing { display: grid; place-items: center; color: #94a3b8; font-size: 8px; font-weight: 900; }
            .qr-block span { color: #475569; font-size: 7.5px; font-weight: 900; white-space: nowrap; }
            .candidate-info { min-width: 0; text-align: center; border-inline: 1px dashed #cbd5e1; padding-inline: 2.8mm; }
            .candidate-info small { display: block; color: #64748b; font-size: 8px; font-weight: 900; }
            .candidate-info strong { display: block; color: #5b21b6; font-size: 28px; line-height: 1; font-weight: 900; }
            .candidate-info b { display: block; margin-top: 1.5mm; font-size: 10px; }
            .candidate-info p { margin: 1.5mm 0 0; font-size: 9px; line-height: 1.25; font-weight: 900; overflow-wrap: anywhere; }
            .card-instructions { grid-column: 1 / -1; padding-top: 2.4mm; border-top: 1px dashed #cbd5e1; color: #334155; font-size: 7.2px; line-height: 1.28; font-weight: 700; }
            .card-instructions b { color: #111827; }
            @media print { body { background: #fff; } }
          </style>
        </head>
        <body><main class="sheet">${cardsHtml}</main></body>
      </html>`);
    win.document.close();
    win.focus();
    window.setTimeout(() => win.print(), 700);
  }

  return (
    <section className="panel admin-report-panel">
      <div className="panel-heading">
        <div>
          <h2>รายงานอัจฉริยะการส่งผลงาน</h2>
          <p>สรุปสถานะหลายมิติสำหรับตรวจติดตาม ออกรายงาน และส่งต่อกรรมการหลังสอบ</p>
        </div>
        <div className="toolbar-actions">
          <button onClick={printReportPdf} disabled={filteredRows.length === 0} title="เปิดเทมเพลตรายงานสวยงามเพื่อบันทึกเป็น PDF">
            <FileCheck2 size={16} />
            PDF
          </button>
          <button onClick={printCandidateCards} disabled={filteredRows.length === 0} title="พิมพ์บัตรเล็กประจำโต๊ะ พร้อม QR ส่งงานและ QR Wi-Fi ที่แยกห่างกัน">
            <Printer size={16} />
            บัตรโต๊ะ
          </button>
          <button onClick={exportReportCsv} disabled={filteredRows.length === 0}>
            <Download size={16} />
            Export CSV
          </button>
        </div>
      </div>

      <div className="report-toolbar">
        <label>
          มุมมอง
          <select value={dimension} onChange={(event) => setDimension(event.target.value as ReportDimension)}>
            <option value="status">สถานะระบบ</option>
            <option value="confirmation">การยืนยัน</option>
            <option value="verification">การตรวจไฟล์</option>
            <option value="risk">ความเสี่ยง/ต้องติดตาม</option>
          </select>
        </label>
        <label>
          กลุ่มข้อมูล
          <select value={focus} onChange={(event) => setFocus(event.target.value as ReportFocus)}>
            <option value="all">ทั้งหมด</option>
            <option value="pending">ยังยืนยันไม่ครบ</option>
            <option value="ready">รอกรรมการ/รอผู้สอบ</option>
            <option value="risk">ต้องติดตาม</option>
          </select>
        </label>
        <span className="report-timer-note">เวลา: {timer?.state === "running" ? "กำลังสอบ" : timer?.state === "ended" ? "สิ้นสุดแล้ว" : "ยังไม่เริ่ม"}</span>
      </div>

      <div className="report-kpi-grid">
        <div><span>ผู้สอบยืนยัน</span><strong>{candidateConfirmedCount}</strong></div>
        <div><span>กรรมการรับรอง</span><strong>{adminConfirmedCount}</strong></div>
        <div><span>รอกรรมการ</span><strong>{readyForAdmin}</strong></div>
        <div><span>ต้องติดตาม</span><strong>{riskCount}</strong></div>
      </div>

      <div className="report-content-grid">
        <div className="report-breakdown">
          {breakdown.map(([label, count]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{count}</strong>
            </div>
          ))}
        </div>
        <div className="table-wrap report-table-wrap">
          <table>
            <thead>
              <tr>
                <th>ลำดับ</th>
                <th>เลขสอบ</th>
                <th>สถานะ</th>
                <th>ผู้สอบ</th>
                <th>กรรมการ</th>
                <th>ติดตาม</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.sequenceNo}</td>
                  <td>{row.applicantNo}</td>
                  <td><StatusBadge status={row.status} progress={row.progress} /></td>
                  <td>{row.candidateConfirmed ? "ยืนยันแล้ว" : "-"}</td>
                  <td>{row.adminConfirmed ? "รับรองแล้ว" : "-"}</td>
                  <td>{row.risk ? "ต้องส่งใหม่" : row.ready ? "รอยืนยัน" : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function downloadCsv(fileName: string, rows: Array<Array<string | number>>) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function qrImageSrc(text: string, size = 220) {
  return `/api/public/qr?size=${size}&text=${encodeURIComponent(text)}`;
}

function candidateSubmitUrl(publicUrl: string, applicantNo?: string) {
  const base = publicUrl || window.location.origin;
  try {
    const url = new URL("/submit", base.endsWith("/") ? base : `${base}/`);
    if (applicantNo) url.searchParams.set("candidate", applicantNo);
    return url.toString();
  } catch {
    const url = new URL("/submit", window.location.origin);
    if (applicantNo) url.searchParams.set("candidate", applicantNo);
    return url.toString();
  }
}

function csvCell(value: string | number) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function escapeHtml(value: string | number) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function CandidateStatusBadge({ status, progress = 0 }: { status: CandidateSummary["status"]; progress?: number }) {
  const label = status === "admin_confirmed" ? "พร้อมยืนยันส่งงาน" : statusLabel(status);
  return (
    <span className={`status-badge ${statusTone(status)}`}>
      {label}
      {status === "uploading" ? ` ${Math.round(progress)}%` : ""}
    </span>
  );
}

function CandidateReviewStatus({ confirmedAt }: { confirmedAt?: string | null }) {
  return (
    <div className="review-status candidate-review-status">
      <div className={confirmedAt ? "ok" : ""}>
        <span>การยืนยันของผู้เข้าสอบ</span>
        <strong>{confirmedAt ? "ยืนยันแล้ว" : "ยังไม่ยืนยัน"}</strong>
        <small>{displayDateTime(confirmedAt)}</small>
      </div>
    </div>
  );
}

function ReviewStatus({
  candidateConfirmedAt,
  adminConfirmedAt
}: {
  candidateConfirmedAt?: string | null;
  adminConfirmedAt?: string | null;
}) {
  return (
    <div className="review-status">
      <div className={candidateConfirmedAt ? "ok" : ""}>
        <span>ผู้ส่ง</span>
        <strong>{candidateConfirmedAt ? "รับรองแล้ว" : "ยังไม่รับรอง"}</strong>
        <small>{displayDateTime(candidateConfirmedAt)}</small>
      </div>
      <div className={adminConfirmedAt ? "ok" : ""}>
        <span>กรรมการ</span>
        <strong>{adminConfirmedAt ? "รับรองแล้ว" : "ยังไม่รับรอง"}</strong>
        <small>{displayDateTime(adminConfirmedAt)}</small>
      </div>
    </div>
  );
}

function FileList({ files }: { files: File[] }) {
  if (!files.length) return <p className="muted-text">ยังไม่ได้เลือกไฟล์</p>;
  return (
    <ul className="file-list">
      {files.map((file) => (
        <li key={`${file.name}-${file.size}`}>
          <FileVideo size={16} />
          <span>{file.name}</span>
          <small>{formatBytes(file.size)}</small>
        </li>
      ))}
    </ul>
  );
}

function SubmissionFiles({ files, onPreview }: { files: SubmissionFile[]; onPreview: (file: SubmissionFile) => void }) {
  if (!files.length) return <p className="muted-text">ไฟล์ที่ตรวจผ่านจะแสดงที่นี่</p>;
  return (
    <div className="submission-files">
      {files.map((file) => (
        <div className="file-row" key={file.id}>
          <div>
            <strong>{file.name}</strong>
            <span>
              {formatBytes(file.size)} • {file.detectedType || "-"} • hash {shortHash(file.sha256)}
            </span>
            {file.videoWidth && file.videoHeight ? (
              <small className="muted-text">
                {file.videoWidth}×{file.videoHeight} • {formatAspectRatio(file.aspectRatio)}
              </small>
            ) : null}
            {file.warning ? <small className="warning-text">{file.warning}</small> : null}
          </div>
          <button onClick={() => onPreview(file)}>
            <Eye size={16} />
            เปิดดู
          </button>
        </div>
      ))}
    </div>
  );
}

function PreviewBox({ preview }: { preview: { file: SubmissionFile; url: string } }) {
  const aspectRatio = validAspectRatio(preview.file.aspectRatio);
  const previewStyle = aspectRatio
    ? ({ "--preview-aspect-ratio": String(aspectRatio) } as CSSProperties)
    : undefined;

  return (
    <div className="preview-box" style={previewStyle}>
      <div className="preview-heading">
        <Eye size={18} />
        <strong>{preview.file.name}</strong>
      </div>
      {isPreviewableVideo(preview.file) ? <video src={preview.url} controls /> : null}
      {isPreviewableImage(preview.file) ? <img src={preview.url} alt={preview.file.name} /> : null}
      {isPreviewablePdf(preview.file) ? <iframe src={preview.url} title={preview.file.name} /> : null}
    </div>
  );
}

function validAspectRatio(value?: number | null) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function formatAspectRatio(value?: number | null) {
  const ratio = validAspectRatio(value);
  if (!ratio) return "ไม่ทราบสัดส่วน";
  if (ratio > 1.15) return `แนวนอน ${ratio.toFixed(2)}:1`;
  if (ratio < 0.87) return `แนวตั้ง ${ratio.toFixed(2)}:1`;
  return `จัตุรัส ${ratio.toFixed(2)}:1`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function ConfirmationCard({ confirmedAt, onDownload }: { confirmedAt?: string | null; onDownload?: () => void }) {
  return (
    <div className="confirmation-card">
      <div className="confirmation-icon">
        <CheckCircle2 size={28} />
      </div>
      <div>
        <strong>ยืนยันการส่งงานแล้ว</strong>
        <small>ยืนยันเมื่อ {displayDateTime(confirmedAt)}</small>
      </div>
      {onDownload ? (
        <button className="ghost proof-download" onClick={onDownload} title="บันทึกรูปภาพหลักฐานการส่งงานไว้ที่เครื่อง">
          <Download size={16} />
          บันทึกหลักฐาน
        </button>
      ) : null}
    </div>
  );
}

function BackupSubmissionLink() {
  return (
    <a className="backup-submission-link" href={googleDriveFallbackUrl} target="_blank" rel="noreferrer">
      <ExternalLink size={16} />
      ช่องทางส่งงานสำรอง Google Drive
    </a>
  );
}

function StatCards({ stats, projector = false }: { stats?: Record<string, number>; projector?: boolean }) {
  const items = [
    ["total", "ทั้งหมด"],
    ["not_started", "ยังไม่เริ่ม"],
    ["uploading", "กำลังส่ง"],
    ["verifying", "กำลังตรวจ"],
    ["ready_to_confirm", "รอยืนยัน"],
    ["candidate_confirmed", "ผู้ส่งรับรอง"],
    ["admin_confirmed", "กรรมการรับรอง"],
    ["confirmed", "ยืนยันแล้ว"],
    ["needs_resubmit", "มีปัญหา"]
  ];
  return (
    <div className={projector ? "stat-cards projector-stats" : "stat-cards"}>
      {items.map(([key, label]) => (
        <div className="stat-card" key={key}>
          <span>{label}</span>
          <strong>{stats?.[key] ?? 0}</strong>
        </div>
      ))}
    </div>
  );
}

function AdminControlBar({
  timer,
  isReadOnly,
  onStart,
  onStop,
  onRestart,
  onExtend,
  onExport,
  onClear
}: {
  timer?: AdminState["timer"] | null;
  isReadOnly: boolean;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onRestart: () => Promise<void>;
  onExtend: () => void;
  onExport: () => void;
  onClear: () => void;
}) {
  return (
    <div className="admin-toolbar" id="control">
      <div className="admin-toolbar-head">
        <div>
          <h2>ควบคุมเวลาสอบ</h2>
          <p>เริ่ม หยุด เพิ่มเวลา และส่งออกข้อมูลจากจุดเดียว</p>
        </div>
        <TimerPill timer={timer} />
      </div>
      <div className="toolbar-actions">
        <TimerControlPanel
          timer={timer}
          isReadOnly={isReadOnly}
          onStart={onStart}
          onStop={onStop}
          onRestart={onRestart}
        />
        <button disabled={isReadOnly} onClick={onExtend}>
          <Clock size={16} />
          +5 นาที (เพิ่มได้เรื่อยๆ)
        </button>
        <button disabled={isReadOnly} onClick={onExport}>
          <Download size={16} />
          Export
        </button>
        <button className="danger-outline" disabled={isReadOnly} onClick={onClear}>
          <Trash2 size={16} />
          Clear Test Data
        </button>
      </div>
    </div>
  );
}

function CandidateTable({
  rows,
  onSelect
}: {
  rows: CandidateSummary[];
  onSelect: (row: CandidateSummary) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>ลำดับ</th>
            <th>เลขสมัคร</th>
            <th>ชื่อ - สกุล</th>
            <th>สถานะ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} onClick={() => onSelect(row)}>
              <td>{row.sequenceNo}</td>
              <td>{row.applicantNo}</td>
              <td>{row.fullName}</td>
              <td>
                <StatusBadge status={row.status} progress={row.progress} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdminActionQueue({
  rows,
  onSelect
}: {
  rows: CandidateSummary[];
  onSelect: (row: CandidateSummary) => void;
}) {
  const [activeGroupKey, setActiveGroupKey] = useState("admin");
  const groups = [
    {
      key: "submitted",
      title: "ส่งงานมาแล้ว",
      detail: "ผ่านขั้นตอนอัปโหลด รอเปิดดูหรือยืนยัน",
      icon: FileCheck2,
      tone: "candidate",
      rows: rows.filter((row) => ["ready_to_confirm", "candidate_confirmed", "admin_confirmed", "confirmed"].includes(row.status))
    },
    {
      key: "review",
      title: "รอการตรวจสอบ",
      detail: "กำลังอัปโหลดหรือระบบกำลังตรวจไฟล์",
      icon: Eye,
      tone: "verify",
      rows: rows.filter((row) => ["uploading", "verifying"].includes(row.status))
    },
    {
      key: "admin",
      title: "รอกรรมการยืนยัน",
      detail: "เปิดดูผลงานและกดยืนยันให้เสร็จ",
      icon: ShieldCheck,
      tone: "ready",
      rows: rows.filter((row) => ["candidate_confirmed", "ready_to_confirm"].includes(row.status))
    },
    {
      key: "problem",
      title: "ต้องติดตาม",
      detail: "มีปัญหา เปิดสิทธิ์ใหม่ หรือส่งใหม่",
      icon: AlertTriangle,
      tone: "bad",
      rows: rows.filter((row) => ["needs_resubmit", "admin_unlocked"].includes(row.status) || Boolean(row.errorMessage))
    }
  ].map((group) => ({
    ...group,
    rows: [...group.rows].sort((a, b) => a.sequenceNo - b.sequenceNo)
  }));
  const readyNow = groups.find((group) => group.key === "admin")?.rows.length || 0;
  const activeGroup = groups.find((group) => group.key === activeGroupKey) || groups[2];
  return (
    <section className={`panel action-queue ${readyNow ? "has-ready" : ""}`}>
      <div className="panel-heading compact-heading">
        <div>
          <h2>งานที่ควรดูตอนนี้</h2>
          <p>ดูภาพรวมเป็น card แล้วเปิดรายถัดไปได้ทันที ไม่ต้องเลื่อนหาในตารางรวม</p>
        </div>
        <div className="action-queue-count">
          <Bell size={18} />
          <strong>{readyNow}</strong>
        </div>
      </div>
      <div className="action-summary-grid">
        {groups.map((group) => {
          const Icon = group.icon;
          const first = group.rows[0];
          return (
            <button
              className={`action-summary-card ${group.tone} ${activeGroupKey === group.key ? "active" : ""}`}
              key={group.key}
              onClick={() => setActiveGroupKey(group.key)}
              title={first ? `เปิดรายการ ${group.title}` : "ยังไม่มีรายการในกลุ่มนี้"}
            >
              <span className="action-summary-icon"><Icon size={22} /></span>
              <span className="action-summary-copy">
                <strong>{group.title}</strong>
                <small>{group.detail}</small>
              </span>
              <b>{group.rows.length}</b>
              <em>{first ? "เปิดรายการ" : "ไม่มีรายการ"}</em>
              <span className="action-summary-mini">
                {group.rows.slice(0, 3).map((row) => (
                  <i key={row.id}>{String(row.sequenceNo).padStart(2, "0")}</i>
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <div className="action-drilldown">
        <div className="action-drilldown-head">
          <div>
            <h3>{activeGroup.title}</h3>
            <p>{activeGroup.detail}</p>
          </div>
          <strong>{activeGroup.rows.length}</strong>
        </div>
        {activeGroup.rows.length ? (
          <div className="action-drilldown-list">
            {activeGroup.rows.map((row) => (
              <button className={`action-drilldown-row ${statusTone(row.status)}`} key={row.id} onClick={() => onSelect(row)}>
                <strong>{String(row.sequenceNo).padStart(2, "0")}</strong>
                <span>
                  {row.applicantNo}
                  <small>{row.fullName || "-"}</small>
                </span>
                <em>{row.status === "uploading" ? `${Math.round(row.progress || 0)}%` : statusLabel(row.status)}</em>
                <Eye size={16} />
              </button>
            ))}
          </div>
        ) : (
          <div className="action-queue-empty">
            <CheckCircle2 size={18} />
            ยังไม่มีรายการในกลุ่มนี้
          </div>
        )}
      </div>
    </section>
  );
}

function AdminInspector({
  detail,
  preview,
  isReadOnly,
  onPreview,
  onUnlock,
  onAdminConfirm,
  onSaveCandidate,
  onBack
}: {
  token: string;
  detail: CandidateDetail | null;
  preview: { file: SubmissionFile; url: string } | null;
  isReadOnly: boolean;
  onPreview: (file: SubmissionFile) => void;
  onUnlock: (reason: string) => Promise<unknown>;
  onAdminConfirm: () => Promise<void>;
  onSaveCandidate: (id: string, payload: { sequenceNo: number; applicantNo: string; fullName: string; note?: string }) => Promise<void>;
  onBack: () => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState({ sequenceNo: 0, applicantNo: "", fullName: "", note: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!detail) return;
    setDraft({
      sequenceNo: detail.sequenceNo,
      applicantNo: detail.applicantNo,
      fullName: detail.fullName || "",
      note: detail.note || ""
    });
    setEditOpen(false);
  }, [detail]);

  if (!detail) {
    return (
      <div className="empty-state">
        <Eye size={28} />
        <p>เลือกผู้เข้าสอบเพื่อดูรายละเอียดไฟล์ สถานะ และเวลายืนยัน</p>
      </div>
    );
  }
  const verifiedFiles = detail.files.filter((file) => file.status === "verified");
  const canAdminConfirm =
    verifiedFiles.length > 0 &&
    !detail.submission.adminConfirmedAt &&
    ["ready_to_confirm", "candidate_confirmed"].includes(detail.submission.status);

  async function saveCandidate() {
    if (isReadOnly || saving) return;
    const payload = {
      sequenceNo: Number(draft.sequenceNo),
      applicantNo: draft.applicantNo.trim(),
      fullName: draft.fullName.trim(),
      note: draft.note.trim()
    };
    setSaving(true);
    try {
      await onSaveCandidate(detail.id, payload);
      setEditOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="panel-heading">
        <div>
          <h2>
            {detail.sequenceNo}. {detail.fullName}
          </h2>
          <p>{detail.applicantNo}</p>
        </div>
        <StatusBadge status={detail.submission.status} progress={detail.submission.progress} />
      </div>
      <div className="inspector-actions">
        <button type="button" className="ghost" onClick={onBack}>
          <ArrowLeft size={16} />
          กลับไปรายชื่อ
        </button>
      </div>
      <div className="admin-edit-card">
        <button type="button" className="ghost" disabled={isReadOnly} onClick={() => setEditOpen((value) => !value)} title="แก้ไขลำดับ เลขสอบ และชื่อผู้เข้าสอบ">
          <Settings size={16} />
          แก้ไขข้อมูลผู้สอบ
        </button>
        {editOpen ? (
          <div className="candidate-edit-form">
            <input
              disabled={isReadOnly}
              type="number"
              value={draft.sequenceNo}
              onChange={(event) => setDraft({ ...draft, sequenceNo: Number(event.target.value) })}
              placeholder="ลำดับ"
            />
            <input
              disabled={isReadOnly}
              value={draft.applicantNo}
              onChange={(event) => setDraft({ ...draft, applicantNo: event.target.value })}
              placeholder="เลขประจำตัวสอบ"
            />
            <input
              disabled={isReadOnly}
              value={draft.fullName}
              onChange={(event) => setDraft({ ...draft, fullName: event.target.value })}
              placeholder="คำนำหน้า ชื่อ นามสกุล"
            />
            <input
              disabled={isReadOnly}
              value={draft.note}
              onChange={(event) => setDraft({ ...draft, note: event.target.value })}
              placeholder="หมายเหตุ"
            />
            <button
              type="button"
              disabled={isReadOnly || saving || !draft.sequenceNo || !draft.applicantNo.trim() || !draft.fullName.trim()}
              onClick={saveCandidate}
            >
              <CheckCircle2 size={16} />
              {saving ? "กำลังบันทึก..." : "บันทึกผู้สอบ"}
            </button>
            <button type="button" className="ghost" onClick={() => setEditOpen(false)} disabled={saving}>
              ยกเลิก
            </button>
          </div>
        ) : null}
      </div>
      <div className="identity-list compact">
        <span>ผู้ส่งรับรอง</span>
        <strong>{displayDateTime(detail.submission.candidateConfirmedAt)}</strong>
        <span>กรรมการรับรอง</span>
        <strong>{displayDateTime(detail.submission.adminConfirmedAt)}</strong>
        <span>ครบถ้วนเมื่อ</span>
        <strong>{displayDateTime(detail.submission.confirmedAt)}</strong>
        <span>backup</span>
        <strong>{detail.submission.backupStatus || "-"}</strong>
      </div>
      <ReviewStatus
        candidateConfirmedAt={detail.submission.candidateConfirmedAt}
        adminConfirmedAt={detail.submission.adminConfirmedAt}
      />
      <SubmissionFiles files={detail.files} onPreview={onPreview} />
      {preview ? <PreviewBox preview={preview} /> : null}
      {detail.submission.errorMessage ? <p className="form-error">{detail.submission.errorMessage}</p> : null}
      <button className="primary-action" disabled={isReadOnly || !canAdminConfirm} onClick={onAdminConfirm}>
        <CheckCircle2 size={20} />
        กรรมการรับรองว่าเปิดดูได้ถูกต้อง
      </button>
      <button
        disabled={isReadOnly}
        className="danger-outline"
        onClick={() => {
          const reason = window.prompt("เหตุผลการเปิดสิทธิ์ส่งใหม่");
          if (reason) onUnlock(reason);
        }}
      >
        <AlertTriangle size={16} />
        เปิดสิทธิ์ส่งใหม่
      </button>
    </div>
  );
}

function AdminSettingsPanel({
  token,
  state,
  isReadOnly,
  onDone,
  onError
}: {
  token: string;
  state: AdminState | null;
  isReadOnly: boolean;
  onDone: () => void;
  onError: (value: string) => void;
}) {
  const settings = state?.settings;
  const [draft, setDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    if (settings) {
      setDraft({
        examTitle: settings.examTitle,
        organization: settings.organization,
        position: settings.position,
        location: settings.location,
        reportTime: settings.reportTime,
        durationSeconds: String(settings.durationSeconds),
        taskDescription: settings.taskDescription,
        instructions: settings.instructions,
        announcement: settings.announcement,
        publicUrl: settings.publicUrlCustom,
        wifiSsid: settings.wifiSsid,
        wifiPassword: settings.wifiPassword
      });
    }
  }, [settings]);

  async function save() {
    try {
      await api.updateSettings(token, draft);
      onDone();
    } catch (err) {
      onError(errorText(err));
    }
  }

  async function uploadQr(file?: File) {
    if (!file) return;
    try {
      await api.uploadWifiQr(token, file);
      onDone();
    } catch (err) {
      onError(errorText(err));
    }
  }

  const effectivePublicUrl = (draft.publicUrl || settings?.publicUrl || "").trim();

  return (
    <section className="panel settings-panel" id="settings">
      <div className="panel-heading">
        <div>
          <h2>รายละเอียดสอบและ QR Wi‑Fi</h2>
          <p>ข้อความส่วนนี้จะแสดงบนจอโปรเจคเตอร์</p>
        </div>
        <Settings size={24} />
      </div>
      <div className="settings-grid">
        <input
          disabled={isReadOnly}
          value={draft.examTitle || ""}
          onChange={(event) => setDraft({ ...draft, examTitle: event.target.value })}
          placeholder="หัวข้อสอบ"
        />
        <input
          disabled={isReadOnly}
          value={draft.organization || ""}
          onChange={(event) => setDraft({ ...draft, organization: event.target.value })}
          placeholder="หน่วยงาน"
        />
        <input
          disabled={isReadOnly}
          value={draft.position || ""}
          onChange={(event) => setDraft({ ...draft, position: event.target.value })}
          placeholder="ตำแหน่ง"
        />
        <input
          disabled={isReadOnly}
          value={draft.location || ""}
          onChange={(event) => setDraft({ ...draft, location: event.target.value })}
          placeholder="สถานที่"
        />
        <input
          disabled={isReadOnly}
          value={draft.durationSeconds || ""}
          onChange={(event) => setDraft({ ...draft, durationSeconds: event.target.value })}
          placeholder="เวลาสอบเป็นวินาที เช่น 3600"
          inputMode="numeric"
        />
        <input
          disabled={isReadOnly}
          value={draft.wifiSsid || ""}
          onChange={(event) => setDraft({ ...draft, wifiSsid: event.target.value })}
          placeholder="ชื่อ Wi-Fi เช่น @Communication"
        />
        <input
          disabled={isReadOnly}
          value={draft.wifiPassword || ""}
          onChange={(event) => setDraft({ ...draft, wifiPassword: event.target.value })}
          placeholder="รหัส Wi-Fi สำหรับพิมพ์บนบัตรโต๊ะ"
        />
        <div>
          <input
            disabled={isReadOnly}
            value={draft.publicUrl || ""}
            onChange={(event) => setDraft({ ...draft, publicUrl: event.target.value })}
            placeholder="ปล่อยว่างเพื่อตรวจจับ IP อัตโนมัติ"
          />
          <p className="muted-text" style={{ fontSize: 12, marginTop: 6 }}>
            URL ที่ใช้ Gen QR: <strong>{effectivePublicUrl || "-"}</strong>
            {draft.publicUrl ? " (กำลังใช้ค่าที่กำหนดเอง)" : " (กำลังใช้งานอยู่)"}
          </p>
        </div>
        <textarea
          disabled={isReadOnly}
          value={draft.taskDescription || ""}
          onChange={(event) => setDraft({ ...draft, taskDescription: event.target.value })}
          placeholder="โจทย์"
        />
        <textarea
          disabled={isReadOnly}
          value={draft.instructions || ""}
          onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
          placeholder="คำชี้แจง"
        />
        <textarea
          disabled={isReadOnly}
          value={draft.announcement || ""}
          onChange={(event) => setDraft({ ...draft, announcement: event.target.value })}
          placeholder="ประกาศ"
        />
        <input
          disabled={isReadOnly}
          value={draft.adminPassword || ""}
          onChange={(event) => setDraft({ ...draft, adminPassword: event.target.value })}
          placeholder="ตั้งรหัส admin ใหม่ (เว้นว่างถ้าไม่เปลี่ยน)"
          type="password"
        />
        <input
          disabled={isReadOnly}
          value={draft.readOnlyPassword || ""}
          onChange={(event) => setDraft({ ...draft, readOnlyPassword: event.target.value })}
          placeholder="ตั้งรหัส read-only ใหม่ (เว้นว่างถ้าไม่เปลี่ยน)"
          type="password"
        />
      </div>
      <div className="settings-qr-preview">
        <div>
          <QrCode size={18} />
          <strong>QR เพจส่งงานจะ Gen ใหม่อัตโนมัติหลังบันทึก URL</strong>
          <span>{effectivePublicUrl || "ยังไม่มี URL สำหรับสร้าง QR"}</span>
        </div>
        {effectivePublicUrl ? <img src={qrImageSrc(effectivePublicUrl, 180)} alt="QR เพจส่งงานตัวอย่าง" /> : null}
      </div>
      <div className="toolbar-actions">
        <button disabled={isReadOnly} onClick={save}>
          <CheckCircle2 size={16} />
          บันทึกและ Gen QR code ใหม่
        </button>
        <label className={`upload-label ${isReadOnly ? "disabled" : ""}`}>
          <Wifi size={16} />
          อัปโหลด QR Wi‑Fi
          <input disabled={isReadOnly} type="file" accept="image/*" onChange={(event) => uploadQr(event.target.files?.[0])} />
        </label>
      </div>
    </section>
  );
}

function AuditLogsPanel({
  logs,
  filters,
  candidates,
  onFiltersChange,
  onRefresh
}: {
  logs: AuditLogEntry[];
  filters: AuditLogFilters;
  candidates: CandidateSummary[];
  onFiltersChange: (next: AuditLogFilters) => void;
  onRefresh: () => void;
}) {
  const update = (key: keyof AuditLogFilters, value: string | number) =>
    onFiltersChange({ ...filters, [key]: value });

  return (
    <section className="panel audit-panel">
      <div className="panel-heading">
        <div>
          <h2>Activity Logs</h2>
          <p>ติดตามกิจกรรม รายการ API และเหตุการณ์สำคัญของระบบแบบละเอียด</p>
        </div>
        <Activity size={24} />
      </div>

      <div className="audit-filters">
        <label>
          <Search size={15} />
          <input
            value={filters.q || ""}
            onChange={(event) => update("q", event.target.value)}
            placeholder="ค้นหา actor, action, path, detail"
          />
        </label>
        <label>
          <ListFilter size={15} />
          <select value={filters.level || ""} onChange={(event) => update("level", event.target.value)}>
            <option value="">ทุกระดับ</option>
            <option value="info">info</option>
            <option value="warning">warning</option>
            <option value="error">error</option>
          </select>
        </label>
        <input
          value={filters.actor || ""}
          onChange={(event) => update("actor", event.target.value)}
          placeholder="actor เช่น admin"
        />
        <input
          value={filters.action || ""}
          onChange={(event) => update("action", event.target.value)}
          placeholder="action เช่น upload"
        />
        <select value={filters.candidateId || ""} onChange={(event) => update("candidateId", event.target.value)}>
          <option value="">ผู้เข้าสอบทั้งหมด</option>
          {candidates.map((candidate) => (
            <option value={candidate.id} key={candidate.id}>
              {candidate.sequenceNo}. {candidate.applicantNo}
            </option>
          ))}
        </select>
        <select value={filters.method || ""} onChange={(event) => update("method", event.target.value)}>
          <option value="">ทุก method</option>
          <option value="GET">GET</option>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="DELETE">DELETE</option>
        </select>
        <input type="datetime-local" value={toLocalInput(filters.from)} onChange={(event) => update("from", fromLocalInput(event.target.value))} />
        <input type="datetime-local" value={toLocalInput(filters.to)} onChange={(event) => update("to", fromLocalInput(event.target.value))} />
        <select value={filters.limit || 100} onChange={(event) => update("limit", Number(event.target.value))}>
          <option value={50}>50 รายการ</option>
          <option value={100}>100 รายการ</option>
          <option value={250}>250 รายการ</option>
          <option value={500}>500 รายการ</option>
        </select>
        <button className="ghost" onClick={onRefresh}>
          <RefreshCw size={16} />
          รีเฟรช
        </button>
      </div>

      <div className="table-wrap audit-table-wrap">
        <table className="audit-table">
          <thead>
            <tr>
              <th>เวลา</th>
              <th>ระดับ</th>
              <th>ผู้กระทำ</th>
              <th>กิจกรรม</th>
              <th>Request</th>
              <th>รายละเอียด</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td>{displayDateTime(log.createdAt)}</td>
                <td>
                  <span className={`log-level ${log.level}`}>{log.level}</span>
                </td>
                <td>
                  <strong>{log.actor}</strong>
                  <small>{log.ip || ""}</small>
                </td>
                <td>
                  <strong>{log.action}</strong>
                  <small>{log.candidateId || ""}</small>
                </td>
                <td>
                  <strong>{[log.requestMethod, log.statusCode].filter(Boolean).join(" ")}</strong>
                  <small>{log.requestPath || "-"}</small>
                </td>
                <td>
                  <code>{compactDetail(log.detail)}</code>
                </td>
              </tr>
            ))}
            {!logs.length ? (
              <tr>
                <td colSpan={6} className="empty-cell">
                  ไม่พบ log ตามเงื่อนไขที่เลือก
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function compactDetail(detail: Record<string, unknown>) {
  const text = JSON.stringify(detail || {});
  return text.length > 240 ? `${text.slice(0, 240)}...` : text;
}

function toLocalInput(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function fromLocalInput(value: string) {
  return value ? new Date(value).toISOString() : "";
}

function errorText(error: unknown) {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return "เกิดข้อผิดพลาด";
}
