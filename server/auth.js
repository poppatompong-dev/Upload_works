import crypto from "node:crypto";
import { openDatabase, getSetting, passwordHash } from "./db.js";

const SESSION_HOURS = 12;

export function createSession(role, candidateId = null) {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_HOURS * 60 * 60 * 1000);
  openDatabase()
    .prepare(
      "INSERT INTO sessions (token,role,candidate_id,expires_at,created_at) VALUES (?,?,?,?,?)"
    )
    .run(token, role, candidateId, expires.toISOString(), now.toISOString());
  return { token, role, expiresAt: expires.toISOString(), candidateId };
}

export function verifyPassword(role, password) {
  const key = role === "readonly" ? "readOnlyPasswordHash" : "adminPasswordHash";
  return passwordHash(password) === getSetting(key);
}

export function readBearer(request) {
  const header = request.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : "";
}

export function getSession(request) {
  const token = readBearer(request) || request.query?.token || "";
  if (!token) return null;
  const row = openDatabase()
    .prepare("SELECT * FROM sessions WHERE token = ? AND expires_at > ?")
    .get(token, new Date().toISOString());
  return row || null;
}

export function requireAdmin(request, reply, allowReadOnly = false) {
  const session = getSession(request);
  if (!session || (session.role !== "admin" && !(allowReadOnly && session.role === "readonly"))) {
    reply.code(401);
    throw new Error("Unauthorized");
  }
  return session;
}

export function requireCandidate(request, reply, candidateId) {
  const session = getSession(request);
  if (!session || session.role !== "candidate" || session.candidate_id !== candidateId) {
    reply.code(401);
    throw new Error("Unauthorized");
  }
  return session;
}

export function canAccessCandidate(request, candidateId) {
  const session = getSession(request);
  if (!session) return false;
  if (session.role === "admin" || session.role === "readonly") return true;
  return session.role === "candidate" && session.candidate_id === candidateId;
}
