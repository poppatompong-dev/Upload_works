import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownUp,
  ArrowLeftRight,
  Activity,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileCheck2,
  FileVideo,
  Home,
  LayoutGrid,
  ListFilter,
  Lock,
  LogOut,
  Monitor,
  Play,
  QrCode,
  RefreshCw,
  RotateCcw,
  Settings,
  Search,
  ShieldCheck,
  Square,
  Table2,
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

type TimerLike = PublicState["timer"] | AdminState["timer"] | null | undefined;
type ProjectorView = "grid" | "table" | "cards" | "vertical" | "horizontal";

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
          <div className="login-icon-wrap">
            <ShieldCheck size={32} />
          </div>
          <h2>ยืนยันตัวผู้เข้าสอบ</h2>
          <p>กรอกลำดับที่หรือเลขประจำตัวผู้สมัคร ระบบจะแสดงชื่อให้ตรวจทานก่อนส่งไฟล์</p>
          <ol className="login-steps">
            <li><span>1</span>กรอกเลขผู้สมัครหรือลำดับที่</li>
            <li><span>2</span>ตรวจสอบชื่อ-สกุลให้ถูกต้อง</li>
            <li><span>3</span>เลือกไฟล์วิดีโอและอัปโหลด</li>
          </ol>
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
            <div className="dropzone-wrap">
              <input
                className="file-input"
                type="file"
                multiple
                accept="video/*,image/*,application/pdf"
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
            {message ? <p className="form-ok">{message}</p> : null}
            {error ? <p className="form-error">{error}</p> : null}
          </div>

          <div className="panel verify-panel">
            <div className="panel-heading">
              <div>
                <h2>ตรวจดูและยืนยัน</h2>
                <p>ผู้ส่งและกรรมการเปิดดูและรับรองได้แยกกัน ระบบจะแสดงสถานะให้ทุกฝ่ายเห็นทันที</p>
              </div>
              <FileCheck2 size={28} />
            </div>
            <ReviewStatus
              candidateConfirmedAt={candidate.submission.candidateConfirmedAt}
              adminConfirmedAt={candidate.submission.adminConfirmedAt}
            />
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
              <ConfirmationCard confirmedAt={candidate.submission.candidateConfirmedAt} />
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
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditFilters, setAuditFilters] = useState<AuditLogFilters>({ limit: 100 });

  const isReadOnly = role === "readonly";

  const refresh = useCallback(async () => {
    if (!token) return;
    const [next, logResult] = await Promise.all([api.adminState(token), api.auditLogs(token, auditFilters)]);
    setState(next);
    setAuditLogs(logResult.logs);
    if (selectedId) {
      setDetail(await api.adminCandidate(token, selectedId));
    }
  }, [token, selectedId, auditFilters]);

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
    setSelectedId(row.id);
    setDetail(await api.adminCandidate(token, row.id));
    setPreview(null);
  }

  async function openPreview(file: SubmissionFile) {
    const result = await api.fileLink(token, file.id, "preview");
    setPreview({ file, url: result.url });
  }

  async function adminConfirm() {
    if (!detail) return;
    await runAction(() => api.adminConfirm(token, detail.id), "กรรมการรับรองว่าเปิดดูได้ถูกต้องแล้ว");
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
        <TimerPill timer={publicState?.timer} />
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
              onAdminConfirm={adminConfirm}
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
        <AuditLogsPanel
          logs={auditLogs}
          filters={auditFilters}
          candidates={state?.candidates || []}
          onFiltersChange={setAuditFilters}
          onRefresh={() => refresh()}
        />
      </section>
    </main>
  );
}

function ProjectorPage() {
  const [state, setState] = useState<PublicState | null>(null);
  const [view, setView] = useState<ProjectorView>(() => {
    const value = new URLSearchParams(window.location.search).get("view");
    return isProjectorView(value) ? value : "grid";
  });

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
  const submittedCount = useMemo(
    () => rows.filter((row) => ["candidate_confirmed", "admin_confirmed", "confirmed"].includes(row.status)).length,
    [rows]
  );
  const activeCount = useMemo(
    () => rows.filter((row) => ["uploading", "verifying", "ready_to_confirm"].includes(row.status)).length,
    [rows]
  );

  function changeView(nextView: ProjectorView) {
    setView(nextView);
    const url = new URL(window.location.href);
    url.searchParams.set("view", nextView);
    window.history.replaceState(null, "", url);
  }

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
          <strong>{formatSeconds(remainingSeconds)}</strong>
        </div>
      </header>

      <section className="projector-body">
        <div className="projector-info">
          <div className="projector-instructions">
            <h2>คำชี้แจง</h2>
            <p>{settings?.taskDescription}</p>
            <p>{settings?.instructions}</p>
            <p>{settings?.announcement}</p>
          </div>
        </div>

        <div className="projector-progress">
          <div className="qr-row">
            <div>
              <div className="qr-header">
                <QrCode size={20} />
                <h2>เข้าเว็บส่งผลงาน</h2>
              </div>
              {state?.systemUrlQr ? (
                <div className="qr-focal-wrap">
                  <img src={state.systemUrlQr} alt="QR URL ระบบส่งผลงาน" />
                </div>
              ) : null}
              <p>{settings?.publicUrl}</p>
            </div>
          </div>
          <div className="projector-progress-head">
            <div>
              <h2>ความคืบหน้าการส่งผลงาน realtime</h2>
              <p>
                {submittedCount}/{rows.length} คนส่งแล้ว • {activeCount} คนกำลังดำเนินการ
              </p>
            </div>
            <div className="projector-view-switch" aria-label="เลือกมุมมองสำหรับโปรเจคเตอร์">
              <button className={view === "grid" ? "active" : ""} onClick={() => changeView("grid")} title="Grid">
                <LayoutGrid size={18} />
                <span>Grid</span>
              </button>
              <button className={view === "table" ? "active" : ""} onClick={() => changeView("table")} title="Table">
                <Table2 size={18} />
                <span>Table</span>
              </button>
              <button className={view === "cards" ? "active" : ""} onClick={() => changeView("cards")} title="Cards">
                <UsersRound size={18} />
                <span>Cards</span>
              </button>
              <button className={view === "vertical" ? "active" : ""} onClick={() => changeView("vertical")} title="Vertical ticker">
                <ArrowDownUp size={18} />
                <span>Up/Down</span>
              </button>
              <button className={view === "horizontal" ? "active" : ""} onClick={() => changeView("horizontal")} title="Horizontal ticker">
                <ArrowLeftRight size={18} />
                <span>Left/Right</span>
              </button>
            </div>
          </div>
          <h2>ความคืบหน้าการส่งผลงาน realtime</h2>
          <ProjectorProgressView rows={rows} view={view} />
          <StatCards stats={state?.stats} projector />
        </div>
      </section>
    </main>
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
          <p>{row.fullName || "-"}</p>
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
  const tickerRows = rows.length > 0 ? [...rows, ...rows] : [];
  return (
    <div className="projector-ticker horizontal" aria-label="Horizontal candidate progress ticker">
      <div className="projector-ticker-track">
        {tickerRows.map((row, index) => (
          <ProjectorTickerChip row={row} key={`${row.id}-${index}`} />
        ))}
      </div>
    </div>
  );
}

function ProjectorTickerRow({ row }: { row: CandidateSummary }) {
  return (
    <div className={`projector-ticker-row ${statusTone(row.status)}`}>
      <strong>{String(row.sequenceNo).padStart(2, "0")}</strong>
      <span>{row.applicantNo}</span>
      <em>{row.fullName || "-"}</em>
      <small>{statusLabel(row.status)}</small>
    </div>
  );
}

function ProjectorTickerChip({ row }: { row: CandidateSummary }) {
  return (
    <div className={`projector-ticker-chip ${statusTone(row.status)}`}>
      <strong>{String(row.sequenceNo).padStart(2, "0")}</strong>
      <span>{row.applicantNo}</span>
      <em>{statusLabel(row.status)}</em>
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
  return (
    <div className={`timer-pill ${isRunning ? "running" : ""}`}>
      {isRunning ? <span className="timer-pulse" aria-hidden="true" /> : null}
      <Clock size={20} />
      <span>{isRunning ? "กำลังสอบ" : timer?.state === "ended" ? "ปิดรับงาน" : "ยังไม่เริ่ม"}</span>
      <strong>{formatSeconds(remainingSeconds)}</strong>
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

function ConfirmationCard({ confirmedAt }: { confirmedAt?: string | null }) {
  return (
    <div className="confirmation-card">
      <div className="confirmation-icon">
        <CheckCircle2 size={28} />
      </div>
      <div>
        <strong>ยืนยันการส่งงานแล้ว</strong>
        <small>ยืนยันเมื่อ {displayDateTime(confirmedAt)}</small>
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

function AdminInspector({
  detail,
  preview,
  isReadOnly,
  onPreview,
  onUnlock,
  onAdminConfirm
}: {
  token: string;
  detail: CandidateDetail | null;
  preview: { file: SubmissionFile; url: string } | null;
  isReadOnly: boolean;
  onPreview: (file: SubmissionFile) => void;
  onUnlock: (reason: string) => Promise<unknown>;
  onAdminConfirm: () => Promise<void>;
}) {
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
