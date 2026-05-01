import fs from "node:fs";
import path from "node:path";
import { openDatabase, logAudit } from "../server/db.js";
import { paths } from "../server/config.js";
import { ensureDir } from "../server/fs-utils.js";

const source = process.argv[2] || path.join(process.cwd(), "data", "roster-pr-2569.csv");

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && quoted && line[i + 1] === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function readRoster(filePath) {
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const [headerLine, ...lines] = text.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(headerLine);
  return lines.map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
  });
}

await ensureDir(paths.dbDir);
await ensureDir(paths.uploadWorksRosterDir);
const rows = readRoster(source);
if (rows.length !== 46) {
  throw new Error(`Expected 46 candidates, got ${rows.length}`);
}

const db = openDatabase();
const now = new Date().toISOString();
const stmt = db.prepare(
  `INSERT INTO candidates (id,sequence_no,applicant_no,full_name,note,created_at,updated_at)
   VALUES (?,?,?,?,?,?,?)
   ON CONFLICT(applicant_no) DO UPDATE SET
     sequence_no=excluded.sequence_no,
     full_name=excluded.full_name,
     note=excluded.note,
     updated_at=excluded.updated_at`
);
db.exec("BEGIN");
try {
  for (const row of rows) {
    stmt.run(
      `cand-${row.applicant_no}`,
      Number(row.sequence_no),
      row.applicant_no,
      row.full_name,
      row.note,
      now,
      now
    );
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}

const csvTarget = path.join(paths.uploadWorksRosterDir, "roster-pr-2569.csv");
const jsonTarget = path.join(paths.uploadWorksRosterDir, "roster-pr-2569.json");
fs.copyFileSync(source, csvTarget);
fs.writeFileSync(jsonTarget, JSON.stringify(rows, null, 2), "utf8");
logAudit("system", "roster_seeded", { count: rows.length, csvTarget, jsonTarget });
console.log(`Seeded ${rows.length} candidates`);
console.log(csvTarget);
console.log(jsonTarget);
