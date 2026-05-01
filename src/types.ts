export type SubmissionStatus =
  | "not_started"
  | "uploading"
  | "verifying"
  | "ready_to_confirm"
  | "confirmed"
  | "needs_resubmit"
  | "expired"
  | "admin_unlocked";

export interface ExamSettings {
  examTitle: string;
  organization: string;
  position: string;
  location: string;
  reportTime: string;
  durationSeconds: number;
  taskDescription: string;
  instructions: string;
  announcement: string;
  publicUrl: string;
  wifiQrAvailable: boolean;
}

export interface TimerState {
  state: "idle" | "running" | "ended";
  durationSeconds: number;
  startAt: string | null;
  deadlineAt: string | null;
  extendedSeconds: number;
  remainingSeconds: number;
}

export interface CandidateSummary {
  id: string;
  sequenceNo: number;
  applicantNo: string;
  fullName?: string;
  status: SubmissionStatus;
  progress: number;
  confirmationCode?: string | null;
  confirmedAt?: string | null;
  errorMessage?: string | null;
  backupStatus?: string;
  backupError?: string | null;
}

export interface SubmissionFile {
  id: string;
  category: "video" | "image" | "document";
  name: string;
  detectedType?: string | null;
  size: number;
  sha256?: string | null;
  status: string;
  durationSeconds?: number | null;
  warning?: string | null;
  errorMessage?: string | null;
}

export interface CandidateDetail {
  id: string;
  sequenceNo: number;
  applicantNo: string;
  fullName: string;
  submission: {
    status: SubmissionStatus;
    progress: number;
    confirmationCode?: string | null;
    startedAt?: string | null;
    uploadCompletedAt?: string | null;
    verifiedAt?: string | null;
    confirmedAt?: string | null;
    errorMessage?: string | null;
    backupStatus?: string | null;
  };
  files: SubmissionFile[];
}

export interface PublicState {
  settings: ExamSettings;
  systemUrlQr: string;
  timer: TimerState;
  stats: Record<string, number>;
  candidates: CandidateSummary[];
  system: {
    dataFreeBytes: number | null;
    backupFreeBytes: number | null;
    warnings: string[];
    dataRoot: string;
    backupRoot: string;
    uploadWorksRoot: string;
  };
}

export interface AdminState extends Omit<PublicState, "systemUrlQr" | "candidates"> {
  candidates: CandidateSummary[];
}
