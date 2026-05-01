import type { AdminState, CandidateDetail, PublicState } from "./types";

export const CHUNK_BYTES = 4 * 1024 * 1024;

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function requestJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok || data.ok === false) {
    throw new ApiError(data.error || response.statusText, response.status);
  }
  return data as T;
}

export const api = {
  publicState: () => requestJson<PublicState>("/api/public/state"),
  login: (password: string, role: "admin" | "readonly") =>
    requestJson<{ ok: true; token: string; role: string; expiresAt: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password, role })
    }),
  adminState: (token: string) =>
    requestJson<AdminState>("/api/admin/state", {
      headers: authHeader(token)
    }),
  adminCandidate: (token: string, id: string) =>
    requestJson<CandidateDetail>(`/api/admin/candidates/${id}`, {
      headers: authHeader(token)
    }),
  updateSettings: (token: string, payload: Record<string, string>) =>
    requestJson<{ ok: true }>("/api/admin/settings", {
      method: "POST",
      headers: authHeader(token),
      body: JSON.stringify(payload)
    }),
  uploadWifiQr: (token: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return requestJson<{ ok: true; url: string }>("/api/admin/wifi-qr", {
      method: "POST",
      headers: authHeader(token),
      body: form
    });
  },
  startTimer: (token: string, durationSeconds = 3600) =>
    requestJson<{ ok: true }>("/api/admin/timer/start", {
      method: "POST",
      headers: authHeader(token),
      body: JSON.stringify({ durationSeconds })
    }),
  stopTimer: (token: string, reason: string) =>
    requestJson<{ ok: true }>("/api/admin/timer/stop", {
      method: "POST",
      headers: authHeader(token),
      body: JSON.stringify({ reason })
    }),
  extendTimer: (token: string, seconds: number, reason: string) =>
    requestJson<{ ok: true }>("/api/admin/timer/extend", {
      method: "POST",
      headers: authHeader(token),
      body: JSON.stringify({ seconds, reason })
    }),
  unlockCandidate: (token: string, id: string, reason: string) =>
    requestJson<{ ok: true }>(`/api/admin/candidates/${id}/unlock`, {
      method: "POST",
      headers: authHeader(token),
      body: JSON.stringify({ reason })
    }),
  exportManifest: (token: string) =>
    requestJson<{ ok: true; jsonPath: string; csvPath: string }>("/api/admin/export", {
      method: "POST",
      headers: authHeader(token)
    }),
  lookupCandidate: (identifier: string) =>
    requestJson<{ ok: true; token: string; candidate: CandidateDetail }>("/api/candidates/lookup", {
      method: "POST",
      body: JSON.stringify({ identifier })
    }),
  candidate: (token: string, id: string) =>
    requestJson<CandidateDetail>(`/api/candidates/${id}`, {
      headers: authHeader(token)
    }),
  createUploadSession: (
    token: string,
    candidateId: string,
    files: Array<{ name: string; size: number; type: string; category: string; totalChunks: number }>
  ) =>
    requestJson<{
      ok: true;
      uploadId: string;
      files: Array<{ id: string; fileIndex: number; name: string; totalChunks: number }>;
    }>(`/api/candidates/${candidateId}/upload-sessions`, {
      method: "POST",
      headers: authHeader(token),
      body: JSON.stringify({ files })
    }),
  uploadChunk: async (
    token: string,
    candidateId: string,
    uploadId: string,
    fileId: string,
    chunkIndex: number,
    blob: Blob
  ) => {
    const response = await fetch("/api/upload-chunks", {
      method: "POST",
      headers: {
        ...authHeader(token),
        "Content-Type": "application/octet-stream",
        "x-candidate-id": candidateId,
        "x-upload-id": uploadId,
        "x-file-id": fileId,
        "x-chunk-index": String(chunkIndex)
      },
      body: blob
    });
    const data = await response.json();
    if (!response.ok || data.ok === false) {
      throw new ApiError(data.error || response.statusText, response.status);
    }
    return data as { ok: true; receivedChunks: number; totalChunks: number; progress: number };
  },
  confirm: (token: string, candidateId: string) =>
    requestJson<{ ok: true }>(`/api/candidates/${candidateId}/confirm`, {
      method: "POST",
      headers: authHeader(token)
    }),
  fileLink: (token: string, fileId: string, kind: "preview" | "original" = "preview") =>
    requestJson<{ ok: true; url: string }>(`/api/file-links/${fileId}`, {
      method: "POST",
      headers: authHeader(token),
      body: JSON.stringify({ kind })
    })
};

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}
