import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileCheck2,
  FileVideo,
  Home,
  Lock,
  LogOut,
  Monitor,
  Play,
  QrCode,
  RefreshCw,
  RotateCcw,
  Settings,
  ShieldCheck,
  Square,
  Upload,
  UsersRound,
  Wifi
} from "lucide-react";
import { api, ApiError, CHUNK_BYTES } from "./api";
import { useRealtime } from "./hooks";
import type { AdminState, CandidateDetail, CandidateSummary, PublicState, SubmissionFile } from "./types";
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

export function App() {
  const path = window.location.pathname;
  if (path.startsWith("/admin")) return <AdminPage />;
  if (path.startsWith("/projector")) return <ProjectorPage />;
  if (path.startsWith("/submit") || path.startsWith("/candidate")) return <CandidatePage />;
  if (path === "/" || path === "") return <PortalPage />;
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
        <div>
          <p className="system-name">{state?.settings.organization || "เทศบาลนครนครสวรรค์"}</p>
          <h1>ระบบส่งผลงานสอบปฏิบัติ</h1>
          <p>{state?.settings.examTitle || "การสอบปฏิบัติตำแหน่งผู้ช่วยนักประชาสัมพันธ์"}</p>
        </div>
        <TimerPill timer={state?.timer} />
      </section>

      <section className="portal-grid">
        <a className="portal-card primary" href="/submit">
          <Upload size={34} />
          <div>
            <h2>ผู้เข้าสอบส่งผลงาน</h2>
            <p>เลือกเลขผู้สมัคร อัปโหลดไฟล์ และยืนยันส่งงาน</p>
          </div>
        </a>
        <a className="portal-card" href="/admin">
          <ShieldCheck size={34} />
          <div>
            <h2>กรรมการควบคุมสอบ</h2>
            <p>ดูภาพรวม ตรวจไฟล์ ควบคุมเวลา และ export</p>
          </div>
        </a>
        <a className="portal-card" href="/projector" target="_blank" rel="noreferrer">
          <Monitor size={34} />
          <div>
            <h2>จอโปรเจคเตอร์</h2>
            <p>แสดง QR, countdown และสถานะส่งงาน</p>
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
  const [identifier, setIdentifier] = useState("");
  const [token, setToken] = useState(() => localStorage.getItem(candidateTokenKey) || "");
  const [candidateId, setCandidateId] = useState(() => localStorage.getItem(candidateIdKey) || "");
  const [candidate, setCandidate] = useState<CandidateDetail | null>(null);
  const [publicState, setPublicState] = useState<PublicState | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [localProgress, setLocalProgress] = useState(0);
  const [preview, setPreview] = useState<{ file: SubmissionFile; url: string } | null>(null);
  const [previewConfirmed, setPreviewConfirmed] = useState(false);

  const refresh = useCallback(async () => {
    const [pub, detail] = await Promise.all([
      api.publicState(),
      token && candidateId ? api.candidate(token, candidateId).catch(() => null) : Promise.resolve(null)
    ]);
    setPublicState(pub);
    if (detail) setCandidate(detail);
  }, [token, candidateId]);

  useEffect(() => {
    refresh().catch(() => undefined);
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
    localStorage.removeItem(candidateTokenKey);
    localStorage.removeItem(candidateIdKey);
    setToken("");
    setCandidateId("");
    setCandidate(null);
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

  const timer = publicState?.timer;
  const canUpload = timer?.state === "running" && (timer.remainingSeconds || 0) > 0;
  const status = candidate?.submission.status || "not_started";
  const verifiedFiles = candidate?.files.filter((file) => file.status === "verified") || [];

  return (
    <main className="app-shell candidate-shell">
      <section className="candidate-hero">
        <div>
          <p className="system-name">{publicState?.settings.organization || "เทศบาลนครนครสวรรค์"}</p>
          <h1>ระบบส่งผลงานสอบปฏิบัติ</h1>
          <p>{publicState?.settings.taskDescription || "ผลิต clip วิดีโอความยาวไม่เกิน 1 นาที"}</p>
        </div>
        <TimerPill timer={timer} />
      </section>

      {publicState?.settings.announcement ? (
        <div className="notice info">
          <AlertTriangle size={18} />
          <span>{publicState.settings.announcement}</span>
        </div>
      ) : null}

      {!candidate ? (
        <section className="panel login-panel">
          <ShieldCheck size={36} />
          <h2>ยืนยันตัวผู้เข้าสอบ</h2>
          <p>กรอกลำดับที่หรือเลขประจำตัวผู้สมัคร ระบบจะแสดงชื่อให้ตรวจทานก่อนส่งไฟล์</p>
          <div className="inline-form">
            <input
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder="เช่น 1 หรือ 07101001"
              inputMode="numeric"
              onKeyDown={(event) => {
                if (event.key === "Enter") lookup();
              }}
            />
            <button onClick={lookup} disabled={busy || !identifier.trim()}>
              <Play size={18} />
              เข้าสู่ระบบส่งงาน
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
                <p>ตรวจสอบให้ตรงกับบัตรประจำตัวก่อนอัปโหลด</p>
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
              <span>ชื่อ - สกุล</span>
              <strong>{candidate.fullName}</strong>
              <span>สถานะ</span>
              <StatusBadge status={status} progress={candidate.submission.progress || localProgress} />
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
            <input
              className="file-input"
              type="file"
              multiple
              accept="video/*,image/*,application/pdf"
              disabled={!canUpload || busy || status === "confirmed"}
              onChange={(event) => setSelectedFiles(Array.from(event.target.files || []))}
            />
            <FileList files={selectedFiles} />
            <div className="progress-track">
              <div style={{ width: `${candidate.submission.progress || localProgress}%` }} />
            </div>
            <button
              className="primary-action"
              disabled={!canUpload || busy || selectedFiles.length === 0 || status === "confirmed"}
              onClick={startUpload}
            >
              <Upload size={20} />
              อัปโหลดผลงาน
            </button>
            {!canUpload ? <p className="form-error">ระบบยังไม่เปิดรับหรือหมดเวลาส่งงานแล้ว</p> : null}
            {message ? <p className="form-ok">{message}</p> : null}
            {error ? <p className="form-error">{error}</p> : null}
          </div>

          <div className="panel verify-panel">
            <div className="panel-heading">
              <div>
                <h2>ตรวจดูและยืนยัน</h2>
                <p>กดยืนยันได้เมื่อระบบตรวจไฟล์และสร้างตัวอย่างสำเร็จ</p>
              </div>
              <FileCheck2 size={28} />
            </div>
            <SubmissionFiles files={verifiedFiles} onPreview={openPreview} />
            {preview ? <PreviewBox preview={preview} /> : null}
            {candidate.submission.status === "ready_to_confirm" ? (
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
              disabled={busy || !previewConfirmed || candidate.submission.status !== "ready_to_confirm"}
              onClick={confirm}
            >
              <CheckCircle2 size={20} />
              ยืนยันการส่งงาน
            </button>
            {candidate.submission.status === "confirmed" ? (
              <ConfirmationCard candidate={candidate} />
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
  const [state, setState] = useState<AdminState | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<CandidateDetail | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<{ file: SubmissionFile; url: string } | null>(null);

  const isReadOnly = role === "readonly";

  const refresh = useCallback(async () => {
    if (!token) return;
    const next = await api.adminState(token);
    setState(next);
    if (selectedId) {
      setDetail(await api.adminCandidate(token, selectedId));
    }
  }, [token, selectedId]);

  useEffect(() => {
    refresh().catch((err) => setError(errorText(err)));
  }, [refresh]);
  useRealtime(() => refresh().catch(() => undefined));

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
    setSelectedId(row.id);
    setDetail(await api.adminCandidate(token, row.id));
    setPreview(null);
  }

  async function openPreview(file: SubmissionFile) {
    const result = await api.fileLink(token, file.id, "preview");
    setPreview({ file, url: result.url });
  }

  async function startPracticalExam() {
    await runAction(() => api.startTimer(token, 3600), "เริ่มสอบปฏิบัติและนับถอยหลัง 60 นาทีแล้ว");
  }

  async function stopPracticalExam() {
    const reason = window.prompt("เหตุผลการหยุดสอบ/หยุดรับงาน");
    if (reason) {
      await runAction(() => api.stopTimer(token, reason), "หยุดสอบและปิดรับงานแล้ว");
    }
  }

  async function restartPracticalExam() {
    const ok = window.confirm("เริ่มนับถอยหลัง 60 นาทีใหม่หรือไม่ การเริ่มใหม่จะไม่ลบไฟล์หรือสถานะที่ส่งไว้แล้ว");
    if (ok) {
      await runAction(() => api.startTimer(token, 3600), "เริ่มนับถอยหลัง 60 นาทีใหม่แล้ว");
    }
  }

  if (!token) {
    return (
      <main className="app-shell admin-login">
        <section className="panel login-panel">
          <Lock size={38} />
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
        <button className="ghost" onClick={logout}>
          <LogOut size={16} />
          ออกจากระบบ
        </button>
      </aside>

      <section className="admin-main">
        <div className="admin-toolbar">
          <StatCards stats={state?.stats} />
          <div className="toolbar-actions">
            <TimerControlPanel
              timer={state?.timer}
              isReadOnly={isReadOnly}
              onStart={startPracticalExam}
              onStop={stopPracticalExam}
              onRestart={restartPracticalExam}
            />
            <button
              disabled={isReadOnly}
              onClick={() => {
                const reason = window.prompt("เหตุผลการขยายเวลา");
                if (reason) runAction(() => api.extendTimer(token, 300, reason), "ขยายเวลา 5 นาทีแล้ว");
              }}
            >
              <Clock size={16} />
              +5 นาที
            </button>
            <button disabled={isReadOnly} onClick={() => runAction(() => api.exportManifest(token), "export สำเร็จ")}>
              <Download size={16} />
              Export
            </button>
            <a className="button-link ghost-link" href="/" target="_blank" rel="noreferrer">
              <Home size={16} />
              Portal
            </a>
            <a className="button-link ghost-link" href="/submit" target="_blank" rel="noreferrer">
              <Upload size={16} />
              ส่งงาน
            </a>
            <a className="button-link" href="/projector" target="_blank" rel="noreferrer">
              <Monitor size={16} />
              Projector
            </a>
          </div>
        </div>

        {state?.system.warnings.length ? (
          <div className="notice bad">
            <AlertTriangle size={18} />
            <span>{state.system.warnings.join(" • ")}</span>
          </div>
        ) : null}
        {message ? <div className="notice ok">{message}</div> : null}
        {error ? <div className="notice bad">{error}</div> : null}

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
            />
          </section>
        </div>

        <AdminSettingsPanel
          token={token}
          state={state}
          isReadOnly={isReadOnly}
          onDone={() => refresh()}
          onError={setError}
        />
      </section>
    </main>
  );
}

function ProjectorPage() {
  const [state, setState] = useState<PublicState | null>(null);

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

  return (
    <main className="projector">
      <header className="projector-header">
        <div>
          <h1>{settings?.examTitle || "ระบบส่งผลงานสอบปฏิบัติ"}</h1>
          <p>
            {settings?.organization} • {settings?.location}
          </p>
        </div>
        <div className="projector-clock">
          <span>เวลาคงเหลือ</span>
          <strong>{formatSeconds(state?.timer.remainingSeconds || 0)}</strong>
        </div>
      </header>

      <section className="projector-body">
        <div className="projector-info">
          <div className="qr-row">
            <div>
              <QrCode size={24} />
              <h2>เข้าเว็บส่งผลงาน</h2>
              {state?.systemUrlQr ? <img src={state.systemUrlQr} alt="QR URL ระบบส่งผลงาน" /> : null}
              <p>{settings?.publicUrl}</p>
            </div>
            <div>
              <Wifi size={24} />
              <h2>Wi‑Fi ห้องสอบ</h2>
              {settings?.wifiQrAvailable ? (
                <img src={`/files/wifi-qr?ts=${Date.now()}`} alt="QR Wi-Fi ห้องสอบ" />
              ) : (
                <div className="qr-placeholder">รอ admin อัปโหลด QR Wi‑Fi</div>
              )}
            </div>
          </div>
          <div className="projector-instructions">
            <h2>คำชี้แจง</h2>
            <p>{settings?.taskDescription}</p>
            <p>{settings?.instructions}</p>
            <p>{settings?.announcement}</p>
          </div>
          <StatCards stats={state?.stats} projector />
        </div>

        <div className="projector-progress">
          <h2>ความคืบหน้าการส่งผลงาน realtime</h2>
          <div className="projector-grid">
            {rows.map((row) => (
              <div className={`projector-cell ${statusTone(row.status)}`} key={row.id}>
                <strong>{String(row.sequenceNo).padStart(2, "0")}</strong>
                <span>{row.applicantNo}</span>
                <em>{statusLabel(row.status)}</em>
                {row.confirmationCode ? <small>{row.confirmationCode}</small> : null}
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
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
  return (
    <div className={`timer-pill ${timer?.state === "running" ? "running" : ""}`}>
      <Clock size={20} />
      <span>{timer?.state === "running" ? "กำลังสอบ" : timer?.state === "ended" ? "ปิดรับงาน" : "ยังไม่เริ่ม"}</span>
      <strong>{formatSeconds(timer?.remainingSeconds || 0)}</strong>
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
  return (
    <div className="preview-box">
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

function ConfirmationCard({ candidate }: { candidate: CandidateDetail }) {
  return (
    <div className="confirmation-card">
      <CheckCircle2 size={24} />
      <div>
        <span>รหัสยืนยัน</span>
        <strong>{candidate.submission.confirmationCode}</strong>
        <small>ยืนยันเมื่อ {displayDateTime(candidate.submission.confirmedAt)}</small>
      </div>
    </div>
  );
}

function StatCards({ stats, projector = false }: { stats?: Record<string, number>; projector?: boolean }) {
  const items = [
    ["total", "ทั้งหมด"],
    ["not_started", "ยังไม่เริ่ม"],
    ["uploading", "กำลังส่ง"],
    ["verifying", "กำลังตรวจ"],
    ["ready_to_confirm", "รอยืนยัน"],
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
            <th>รหัสยืนยัน</th>
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
              <td>{row.confirmationCode || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdminInspector({
  detail,
  preview,
  isReadOnly,
  onPreview,
  onUnlock
}: {
  token: string;
  detail: CandidateDetail | null;
  preview: { file: SubmissionFile; url: string } | null;
  isReadOnly: boolean;
  onPreview: (file: SubmissionFile) => void;
  onUnlock: (reason: string) => Promise<unknown>;
}) {
  if (!detail) {
    return (
      <div className="empty-state">
        <Eye size={28} />
        <p>เลือกผู้เข้าสอบเพื่อดูรายละเอียดไฟล์และรหัสยืนยัน</p>
      </div>
    );
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
      <div className="identity-list compact">
        <span>รหัสยืนยัน</span>
        <strong>{detail.submission.confirmationCode || "-"}</strong>
        <span>ยืนยันเมื่อ</span>
        <strong>{displayDateTime(detail.submission.confirmedAt)}</strong>
        <span>backup</span>
        <strong>{detail.submission.backupStatus || "-"}</strong>
      </div>
      <SubmissionFiles files={detail.files} onPreview={onPreview} />
      {preview ? <PreviewBox preview={preview} /> : null}
      {detail.submission.errorMessage ? <p className="form-error">{detail.submission.errorMessage}</p> : null}
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
        location: settings.location,
        reportTime: settings.reportTime,
        taskDescription: settings.taskDescription,
        instructions: settings.instructions,
        announcement: settings.announcement,
        publicUrl: settings.publicUrl
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

  return (
    <section className="panel settings-panel">
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
          value={draft.location || ""}
          onChange={(event) => setDraft({ ...draft, location: event.target.value })}
          placeholder="สถานที่"
        />
        <input
          disabled={isReadOnly}
          value={draft.publicUrl || ""}
          onChange={(event) => setDraft({ ...draft, publicUrl: event.target.value })}
          placeholder="URL สำหรับ QR ระบบ"
        />
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
      <div className="toolbar-actions">
        <button disabled={isReadOnly} onClick={save}>
          <CheckCircle2 size={16} />
          บันทึกข้อความ
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

function errorText(error: unknown) {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return "เกิดข้อผิดพลาด";
}
