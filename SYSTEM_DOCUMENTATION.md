# System Documentation: NSM Practical Submission

**Document status:** Active source-of-truth for development and operations  
**Last updated:** 2026-05-01  
**System version:** `nsm-practical-submission` package version `1.0.0`  
**Primary owner:** ผู้ดูแลระบบสอบ/ทีมพัฒนาระบบรับส่งผลงาน  
**Update rule:** แก้ระบบเมื่อใด ต้องอัปเดตเอกสารนี้ในรอบงานเดียวกันเสมอ

เอกสารนี้อธิบายระบบรับส่งผลงานสอบปฏิบัติสำหรับตำแหน่งผู้ช่วยนักประชาสัมพันธ์ เทศบาลนครนครสวรรค์ ใช้สำหรับส่งต่อทีมพัฒนา ดูแลระบบ และแก้ไขต่อในอนาคต

> กติกาสำคัญ: ทุกครั้งที่มีการแก้ไข behavior, API, schema ฐานข้อมูล, path เก็บไฟล์, environment variable, deployment script, workflow การสอบ, policy การอัปโหลด หรือหน้าจอหลัก ต้องอัปเดตเอกสารนี้ใน commit เดียวกันเสมอ

## 0. วิธีใช้เอกสารนี้

ให้ถือว่าไฟล์นี้เป็นเอกสารระบบหลักสำหรับการพัฒนาต่อ ใช้คู่กับ source code จริงเท่านั้น หากเนื้อหาในเอกสารขัดกับ code ให้ตรวจ code ล่าสุดก่อน แล้วแก้เอกสารให้ตรงกับ behavior จริงทันที

ก่อนเริ่มแก้ระบบ:

- อ่านหัวข้อที่เกี่ยวข้องกับงาน เช่น API, database, upload flow, deployment หรือ security
- ตรวจว่าการแก้ไขกระทบ frontend, backend, data storage, service script หรือ test หรือไม่
- จดหัวข้อที่ต้องอัปเดตในเอกสารนี้ไว้ตั้งแต่เริ่มงาน

หลังแก้ระบบ:

- อัปเดตหัวข้อที่ behavior เปลี่ยน
- เพิ่มบันทึกในหัวข้อ `22. Change Log`
- รัน test/build ตามระดับความเสี่ยงของงาน
- ถ้าเพิ่ม endpoint, status, env var, path หรือ schema ต้องอัปเดตตาราง/รายการที่เกี่ยวข้องในไฟล์นี้

Baseline ปัจจุบันของเอกสารฉบับนี้:

- Frontend: React 19, Vite 8, TypeScript 6
- Backend: Fastify 5, Node.js ESM
- Database: SQLite ผ่าน `node:sqlite`
- Media pipeline: `file-type`, `ffprobe-static`, `ffmpeg-static`
- Deployment target: Windows machine on LAN, optional Windows Service via `node-windows`
- Main port: `8080`

## 1. ภาพรวมระบบ

ระบบนี้เป็น web application แบบรันภายใน LAN สำหรับรับไฟล์ผลงานจากผู้เข้าสอบจำนวน 46 คน โดยเน้นให้กรรมการควบคุมเวลาสอบ ตรวจสถานะ realtime ตรวจ preview ไฟล์ และ export หลักฐานหลังสอบ

องค์ประกอบหลัก:

- Frontend: React 19 + Vite + TypeScript อยู่ใน `src/`
- Backend: Fastify 5 แบบ ESM อยู่ใน `server/`
- Database: SQLite ผ่าน `node:sqlite` เก็บที่ `D:\ExamSubmissions\PR-2569\database\exam.db` ตามค่าเริ่มต้น
- File storage หลัก: `D:\ExamSubmissions\PR-2569`
- File backup: `C:\ExamSubmissionsBackup\PR-2569`
- Runtime/service: รันเป็น Node.js server และติดตั้งเป็น Windows Service ได้ผ่าน `node-windows`
- Realtime: WebSocket endpoint `/ws`
- Media processing: `ffmpeg-static`, `ffprobe-static`, `file-type`

URL หลัก:

- ผู้เข้าสอบ: `http://<server-ip>:8080` หรือ `/submit`
- กรรมการ: `http://<server-ip>:8080/admin`
- จอโปรเจคเตอร์: `http://<server-ip>:8080/projector`
- Health check: `/api/health`

## 2. เป้าหมายการใช้งาน

ระบบถูกออกแบบเพื่อใช้ในวันสอบปฏิบัติจริงบนเครือข่าย LAN ภายในห้องสอบ ไม่ใช่ระบบ public internet โดย workflow หลักคือ:

1. เจ้าหน้าที่เตรียมรายชื่อผู้เข้าสอบและ seed เข้าฐานข้อมูล
2. กรรมการ login เข้า `/admin`
3. กรรมการเริ่ม timer เพื่อเปิดรับงาน
4. ผู้เข้าสอบกรอกลำดับหรือเลขสมัครเพื่อยืนยันตัวตน
5. ผู้เข้าสอบอัปโหลดไฟล์ โดยต้องมีวิดีโออย่างน้อย 1 ไฟล์
6. ระบบรับไฟล์แบบ chunk, ประกอบไฟล์, ตรวจชนิดไฟล์, สร้าง preview และ hash
7. ผู้เข้าสอบเปิดดู preview แล้วกดยืนยันการส่ง
8. กรรมการดูสถานะ realtime และ export manifest หลังสอบ

## 3. โครงสร้างไฟล์สำคัญ

```text
.
├─ src/                      Frontend React
│  ├─ App.tsx                หน้าจอ portal, candidate, admin, projector
│  ├─ api.ts                 client API wrapper และ chunk upload
│  ├─ hooks.ts               realtime hook
│  ├─ types.ts               shared frontend types
│  ├─ utils.ts               format/status helper
│  └─ styles.css             CSS ทั้งระบบ
├─ server/                   Backend Fastify
│  ├─ index.js               bootstrap server, เตรียม directory, เปิด DB
│  ├─ config.js              config, path, upload policy
│  ├─ routes.js              API routes, static serving, file links
│  ├─ db.js                  SQLite schema, settings, audit, query helper
│  ├─ auth.js                session/password/authorization
│  ├─ state.js               public/admin state payload และ system warnings
│  ├─ upload.js              upload session, chunk, verify, confirm
│  ├─ media.js               file detection, ffprobe, transcode preview
│  ├─ exporter.js            candidate/global manifest และ backup
│  ├─ realtime.js            websocket broadcast
│  └─ fs-utils.js            filesystem helper
├─ scripts/
│  ├─ seed-roster.js         import รายชื่อผู้เข้าสอบจาก CSV
│  ├─ export-manifest.js     export summary/manifest
│  ├─ install-service.js     ติดตั้ง Windows Service
│  └─ uninstall-service.js   ถอน Windows Service
├─ ops/
│  ├─ open-firewall.ps1      เปิด firewall port 8080
│  ├─ install-service.ps1    build, seed, install service
│  ├─ start-console.ps1      run production แบบ console
│  ├─ export-now.ps1         export manifest ทันที
│  └─ uninstall-service.ps1  ถอน service
├─ data/
│  └─ roster-pr-2569.csv     รายชื่อผู้เข้าสอบต้นทาง
└─ tests/                    node:test
```

## 4. Runtime และ Configuration

ค่าเริ่มต้นอยู่ใน `server/config.js`

Environment variables:

| Variable | ค่าเริ่มต้น | ความหมาย |
| --- | --- | --- |
| `PORT` | `8080` | port backend production |
| `HOST` | `0.0.0.0` | bind address เพื่อให้เครื่องใน LAN เข้าได้ |
| `EXAM_DATA_ROOT` | `D:\ExamSubmissions\PR-2569` | root เก็บ DB, submissions, exports, logs |
| `EXAM_BACKUP_ROOT` | `C:\ExamSubmissionsBackup\PR-2569` | root สำรองไฟล์และ exports |
| `UPLOAD_WORKS_DIR` | `%USERPROFILE%\Documents\Upload_Works` | root สำหรับ roster/assets ที่เจ้าหน้าที่เห็นได้ง่าย |
| `EXAM_ADMIN_PASSWORD` | `Admin@PR2569` | password admin เริ่มต้น |
| `EXAM_READONLY_PASSWORD` | `View@PR2569` | password read-only เริ่มต้น |
| `PUBLIC_URL` | auto detect LAN IP | URL ที่ใช้สร้าง QR บน projector |
| `LOG_LEVEL` | `info` | log level ของ Fastify |

Path ย่อยที่ระบบสร้าง:

- `database/exam.db`: SQLite database
- `submissions/`: ผลงานผู้เข้าสอบ แยกตาม candidate folder
- `_tmp/`: chunk upload ชั่วคราว
- `exports/`: global manifest และ CSV summary
- `logs/`: เตรียมไว้สำหรับ log/output
- backup `submissions/` และ `exports/` ที่ `EXAM_BACKUP_ROOT`
- `Upload_Works/roster`: สำเนา roster CSV/JSON
- `Upload_Works/assets`: ไฟล์ QR Wi-Fi

Upload policy:

- chunk size: 4 MB
- warning พื้นที่ disk ต่ำ: น้อยกว่า 20 GB
- image ที่อนุญาต: JPEG, PNG, WebP, GIF
- document ที่อนุญาต: PDF
- video: MIME ที่ขึ้นต้นด้วย `video/`

## 5. การรันระบบ

Development:

```powershell
npm install
npm run dev
```

คำสั่ง `npm run dev` รันพร้อมกัน:

- Vite dev server ที่ `0.0.0.0:5173`
- Backend ที่ `0.0.0.0:8080`
- Vite proxy `/api`, `/files`, `/ws` ไป backend

Production แบบ console:

```powershell
ops\start-console.ps1
```

Production แบบ Windows Service:

```powershell
ops\open-firewall.ps1
ops\install-service.ps1
```

`ops\install-service.ps1` ทำสิ่งต่อไปนี้:

1. ตรวจว่ารัน PowerShell แบบ Administrator
2. `npm run build`
3. `npm run seed:roster`
4. `node scripts\install-service.js`

Service name:

```text
NSM Practical Submission
```

## 6. Frontend Architecture

Frontend มี entry point ที่ `src/main.tsx` และ component หลักที่ `src/App.tsx`

Routing ใช้ `window.location.pathname` แบบง่าย ไม่มี React Router:

- `/`: `PortalPage`
- `/submit` และ `/candidate`: `CandidatePage`
- `/admin`: `AdminPage`
- `/projector`: `ProjectorPage`

State หลักถูกดึงผ่าน REST API และ refresh ด้วย WebSocket:

- `useRealtime()` ต่อ `/ws`
- เมื่อ server broadcast `state-changed` หน้าเว็บจะ refresh state ใหม่
- Projector มี interval 1 วินาทีเพิ่มเพื่อ countdown ลื่นขึ้น

Local storage keys:

- `exam:candidateToken`
- `exam:candidateId`
- `exam:adminToken`
- `exam:adminRole`

หน้าจอผู้เข้าสอบ:

- lookup ด้วยลำดับหรือเลขสมัคร
- เลือกหลายไฟล์ แต่ต้องมีวิดีโออย่างน้อย 1 ไฟล์
- frontend แบ่งไฟล์เป็น chunk ขนาด 4 MB
- upload ทีละ chunk ผ่าน `/api/upload-chunks`
- เปิด preview ผ่าน temporary file link
- ต้อง tick ยืนยันว่าเปิดดูตัวอย่างแล้วก่อน confirm

หน้าจอกรรมการ:

- login ได้ 2 role: `admin`, `readonly`
- admin แก้ settings, เริ่ม/หยุด/ขยายเวลา, unlock candidate, upload QR Wi-Fi, export ได้
- readonly ดูข้อมูลได้ แต่ไม่ควรแก้ไข state
- ดูรายชื่อทั้งหมดพร้อมชื่อเต็มและสถานะ
- เปิด preview ไฟล์ candidate ได้

หน้าจอ projector:

- แสดง QR URL ระบบ
- แสดง QR Wi-Fi หาก admin upload แล้ว
- แสดง countdown, คำชี้แจง, สถิติ และสถานะรายลำดับ
- ไม่แสดงชื่อเต็มผู้เข้าสอบ เพื่อปกป้องข้อมูลส่วนบุคคล

## 7. Backend Architecture

`server/index.js` สร้าง Fastify app และ bootstrap ระบบ:

1. สร้าง directory ที่จำเป็นทั้งหมด
2. เปิด SQLite database และ migrate schema
3. register routes
4. listen ที่ `HOST:PORT`
5. เขียน audit log `server_started`

Plugin ที่ register:

- `@fastify/websocket`
- `@fastify/multipart`
- `@fastify/static` เฉพาะเมื่อมี `dist/client`

Body limit:

- Fastify body limit: 8 MB
- octet-stream parser: chunk size + 1 MB
- multipart สำหรับ QR Wi-Fi: 5 MB, 1 file

Static serving:

- production build อยู่ที่ `dist/client`
- หาก path ไม่ใช่ `/api` หรือ `/files` จะ fallback เป็น `index.html`

## 8. Database Schema

SQLite อยู่ที่ `paths.dbPath` และเปิดด้วย:

- `PRAGMA journal_mode = WAL`
- `PRAGMA foreign_keys = ON`
- `PRAGMA busy_timeout = 5000`

ตารางหลัก:

### `settings`

เก็บ key/value settings เช่นหัวข้อสอบ, สถานที่, password hash, announcement, QR path

Fields:

- `key`
- `value`
- `updated_at`

### `candidates`

รายชื่อผู้เข้าสอบ

Fields สำคัญ:

- `id`: เช่น `cand-07101001`
- `sequence_no`: ลำดับสอบ unique
- `applicant_no`: เลขสมัคร unique
- `full_name`
- `note`

### `submissions`

สถานะการส่งงานของ candidate หนึ่งคน

Status ที่ใช้:

- `not_started`
- `uploading`
- `verifying`
- `ready_to_confirm`
- `confirmed`
- `needs_resubmit`
- `admin_unlocked`

Fields สำคัญ:

- `candidate_id`
- `active_upload_id`
- `progress`
- `started_at`
- `upload_completed_at`
- `verifying_at`
- `verified_at`
- `confirmed_at`
- `confirmation_code`
- `error_message`
- `backup_status`
- `backup_error`

### `files`

ไฟล์ทั้งหมดใน upload session

Fields สำคัญ:

- `id`
- `candidate_id`
- `upload_id`
- `file_index`
- `category`: `video`, `image`, `document`
- `original_name`
- `declared_type`
- `detected_type`
- `size`
- `expected_size`
- `sha256`
- `original_path`
- `preview_path`
- `thumbnail_path`
- `status`
- `total_chunks`
- `received_chunks`
- `duration_seconds`
- `warning`
- `error_message`

### `timer`

มี row เดียว `id = 1`

Fields:

- `state`: `idle`, `running`, `ended`
- `duration_seconds`
- `start_at`
- `deadline_at`
- `extended_seconds`

### `audit_logs`

บันทึกเหตุการณ์สำคัญ เช่น login, start timer, upload session, confirm, export

### `sessions`

session token สำหรับ admin, readonly, candidate

- อายุ session: 12 ชั่วโมง
- token เป็น random base64url 32 bytes

## 9. API Reference

### Public

`GET /api/health`

คืนสถานะ server, เวลา, root storage

`GET /api/public/state`

คืน public settings, QR URL, timer, stats, candidate status แบบไม่เปิดเผยชื่อเต็ม

`GET /ws`

WebSocket สำหรับรับ event `state-changed`

### Auth

`POST /api/auth/login`

Body:

```json
{ "password": "...", "role": "admin" }
```

role ที่รองรับ:

- `admin`
- `readonly`

คืน token สำหรับใช้ใน `Authorization: Bearer <token>`

### Admin

ทุก endpoint ต้องใช้ admin token ยกเว้น endpoint ที่ระบุว่า readonly เข้าได้

`GET /api/admin/state`

- admin และ readonly เข้าได้
- คืน settings, timer, stats, candidates พร้อมชื่อเต็ม

`GET /api/admin/settings`

- admin และ readonly เข้าได้

`POST /api/admin/settings`

แก้ settings และ password

Allowed keys:

- `examTitle`
- `organization`
- `position`
- `location`
- `reportTime`
- `taskDescription`
- `instructions`
- `announcement`
- `publicUrl`
- `adminPassword`
- `readOnlyPassword`

`POST /api/admin/wifi-qr`

อัปโหลดรูป QR Wi-Fi รองรับ JPG/PNG/WebP/GIF

`POST /api/admin/timer/start`

Body:

```json
{ "durationSeconds": 3600 }
```

`POST /api/admin/timer/extend`

Body:

```json
{ "seconds": 300, "reason": "..." }
```

ต้องมี reason

`POST /api/admin/timer/stop`

Body:

```json
{ "reason": "manual stop" }
```

`POST /api/admin/candidates/:id/unlock`

เปิดสิทธิ์ส่งใหม่ ต้องมี reason ระบบจะ set status เป็น `admin_unlocked`, clear active upload และ progress

`GET /api/admin/candidates/:id`

- admin และ readonly เข้าได้
- คืน candidate detail พร้อม files

`POST /api/admin/export`

สร้าง global manifest JSON และ summary CSV พร้อมสำรองไป backup root

### Candidate

`POST /api/candidates/lookup`

Body:

```json
{ "identifier": "1" }
```

ค้นได้ด้วย:

- `sequence_no`
- `applicant_no`
- รองรับเลขไทยโดย normalize เป็นเลขอารบิก

คืน candidate token และ candidate detail

`GET /api/candidates/:id`

ต้องใช้ candidate token ของ id เดียวกัน

`POST /api/candidates/:id/upload-sessions`

สร้าง upload session ต้องอยู่ในช่วงเวลาที่ timer running และยังไม่หมดเวลา

Body:

```json
{
  "files": [
    {
      "name": "clip.mp4",
      "size": 123456,
      "type": "video/mp4",
      "category": "video",
      "totalChunks": 1
    }
  ]
}
```

เงื่อนไข:

- ต้องมีไฟล์อย่างน้อย 1 ไฟล์
- ต้องมีไฟล์ category `video` อย่างน้อย 1 ไฟล์
- หาก submission เป็น `confirmed` แล้วจะส่งซ้ำไม่ได้ เว้นแต่ admin unlock

`POST /api/upload-chunks`

ส่ง binary chunk ด้วย `Content-Type: application/octet-stream`

Headers:

- `Authorization: Bearer <candidate-token>`
- `x-candidate-id`
- `x-upload-id`
- `x-file-id`
- `x-chunk-index`

ระบบจะเขียน chunk ลง `_tmp/<uploadId>/<fileId>/000000.part` และเมื่อครบทุก chunk จะประกอบไฟล์อัตโนมัติ

`POST /api/candidates/:id/confirm`

ยืนยันการส่งได้เฉพาะ status `ready_to_confirm`

`POST /api/file-links/:fileId`

สร้าง temporary file access link สำหรับ preview/original

Body:

```json
{ "kind": "preview" }
```

Token link หมดอายุใน 30 นาที

`GET /files/access/:token`

เปิดไฟล์ผ่าน token ชั่วคราว

`GET /files/wifi-qr`

เปิดไฟล์ QR Wi-Fi ที่ admin upload

## 10. Upload และ Verification Flow

Flow แบบละเอียด:

1. Candidate lookup แล้วได้ session token
2. Frontend ตรวจไฟล์เบื้องต้นด้วย MIME/category จาก browser
3. Frontend เรียก `createUploadSession`
4. Backend ตรวจว่า timer เปิดอยู่และ candidate ยังไม่ confirmed
5. Backend สร้าง `uploadId`, insert rows ใน `files`, set submission เป็น `uploading`
6. Frontend slice ไฟล์เป็น chunk 4 MB แล้วส่ง `/api/upload-chunks`
7. Backend เขียน chunk ลง temp folder
8. เมื่อไฟล์หนึ่งครบทุก chunk ระบบ assemble เป็นไฟล์ original
9. เมื่อทุกไฟล์ใน upload session ครบ ระบบ set submission เป็น `verifying`
10. `verifySubmission()` ทำงาน async
11. ตรวจ MIME จริงด้วย `file-type`
12. ตรวจว่ามี video จริงอย่างน้อย 1 ไฟล์
13. คำนวณ SHA-256
14. สำหรับ video ใช้ ffprobe ตรวจ video stream และ duration
15. ถ้า duration มากกว่า 65 วินาที จะไม่ reject แต่ใส่ warning ให้กรรมการตรวจ
16. สร้าง preview MP4 ด้วย ffmpeg และ thumbnail JPG
17. set file เป็น `verified`
18. สร้าง confirmation code รูปแบบ `PR<sequence>-<random>`
19. set submission เป็น `ready_to_confirm`
20. เขียน candidate manifest
21. backup candidate folder
22. broadcast realtime
23. Candidate เปิด preview แล้ว confirm
24. ระบบ set submission เป็น `confirmed`, เขียน manifest อีกครั้ง และ backup อีกครั้ง

เมื่อ verification fail:

- submission เป็น `needs_resubmit`
- `error_message` เก็บข้อความสาเหตุ
- audit log action `verification_failed`
- candidate ต้อง upload ใหม่ หรือให้ admin unlock ตามสถานการณ์

## 11. File Storage Layout

ตัวอย่าง layout ภายใต้ `EXAM_DATA_ROOT`:

```text
D:\ExamSubmissions\PR-2569
├─ database\
│  └─ exam.db
├─ submissions\
│  └─ 01_07101001_ชื่อผู้เข้าสอบ\
│     ├─ original\
│     │  └─ 01_clip_<fileid>.mp4
│     ├─ preview\
│     │  ├─ <fileid>.mp4
│     │  └─ <fileid>.jpg
│     └─ manifest.json
├─ _tmp\
│  └─ <uploadId>\<fileId>\000000.part
├─ exports\
│  ├─ exam-manifest-<timestamp>.json
│  └─ exam-summary-<timestamp>.csv
└─ logs\
```

Backup layout ภายใต้ `EXAM_BACKUP_ROOT`:

```text
C:\ExamSubmissionsBackup\PR-2569
├─ submissions\
└─ exports\
```

Folder candidate ใช้รูปแบบ:

```text
<sequence_no padded 2 digits>_<applicant_no>_<safe full name>
```

ระบบ sanitize filename ด้วย `safeFileName()`:

- normalize NFKC
- แทนอักขระต้องห้าม Windows ด้วย `_`
- trim whitespace
- จำกัดความยาว 140 ตัวอักษร

## 12. Export และ Manifest

Candidate manifest:

- เขียนที่ `submissions/<candidateFolder>/manifest.json`
- เขียนหลัง verification สำเร็จ
- เขียนอีกครั้งหลัง candidate confirm

ข้อมูลใน candidate manifest:

- `generatedAt`
- candidate: sequence, applicant no, full name
- submission row
- files: category, original name, detected type, size, sha256, duration, warning, status

Global export:

เรียกได้จาก admin UI หรือ:

```powershell
npm run export:manifest
```

ผลลัพธ์:

- `exports/exam-manifest-<timestamp>.json`
- `exports/exam-summary-<timestamp>.csv`

ระบบ copy ทั้งสองไฟล์ไป `backupExportsDir` ด้วย

## 13. Authentication และ Authorization

Password:

- เก็บเป็น SHA-256 hash ใน `settings`
- ค่า default seed จาก env หรือ config
- admin เปลี่ยน password ผ่าน `/api/admin/settings`

Session:

- token random 32 bytes base64url
- เก็บใน table `sessions`
- อายุ 12 ชั่วโมง
- อ่าน token จาก `Authorization: Bearer ...` หรือ query `?token=...`

Role:

- `admin`: อ่าน/เขียน control ทุกอย่าง
- `readonly`: อ่าน admin state/settings/candidate detail ได้ แต่ endpoint เขียนส่วนใหญ่ถูก block
- `candidate`: เข้าถึงได้เฉพาะ candidate id ของตัวเอง

File access:

- ไม่เปิด path จริงโดยตรง
- ต้องขอ temporary token ผ่าน `/api/file-links/:fileId`
- token อยู่ใน memory `Map` และหมดอายุ 30 นาที
- เมื่อ restart server token file link เดิมจะใช้ไม่ได้

## 14. Realtime Model

Server เก็บ WebSocket connections ใน memory `Set`

เมื่อ state สำคัญเปลี่ยนจะเรียก `broadcast()` เช่น:

- settings update
- upload session created
- chunk progress
- verification start/finish/fail
- confirm
- timer start/extend/stop
- unlock candidate
- QR Wi-Fi upload

Payload เริ่มต้น:

```json
{ "type": "state-changed", "at": "..." }
```

Frontend ไม่ใช้ payload เป็น source of truth แต่ใช้เป็น signal ให้ดึง state ใหม่จาก REST API

## 15. Timer และ Exam Control

Timer อยู่ใน table `timer` row `id=1`

สถานะ:

- `idle`: ยังไม่เริ่ม
- `running`: เปิดรับ upload
- `ended`: ปิดรับงาน

Backend ตรวจ `isTimerOpen()` ใน:

- `createUploadSession`
- `acceptChunk`

หมายความว่า:

- ถ้าเวลาหมดก่อนเริ่ม session จะสร้าง session ไม่ได้
- ถ้าเวลาหมดระหว่าง upload chunk ต่อไปจะถูก reject
- งานที่ upload ครบและกำลัง verify สามารถ verify ต่อได้

## 16. Security และ Data Protection

สิ่งที่ระบบทำแล้ว:

- แยก role admin/readonly/candidate
- candidate เข้าถึงเฉพาะข้อมูลตัวเอง
- public/projector ไม่แสดงชื่อเต็ม
- ตรวจ MIME จริงจาก content ไม่เชื่อ browser MIME อย่างเดียว
- sanitize filename
- ตรวจ path ไม่ให้ออกนอก storage root ด้วย `assertInside()`
- file link ใช้ token ชั่วคราว
- audit log เหตุการณ์สำคัญ
- reject file unsupported
- ใช้ local LAN เป็นเป้าหมาย deployment

ข้อควรระวัง:

- password default ต้องเปลี่ยนก่อนวันสอบจริง
- session token เก็บใน localStorage จึงควรใช้กับเครื่อง/เครือข่ายที่ควบคุมได้
- temporary file access token เก็บใน memory ถ้า restart จะหาย
- ไม่มี HTTPS ในตัว หากต้องใช้บน network ที่ไม่ควบคุมควรเพิ่ม reverse proxy/TLS
- ข้อความภาษาไทยบางส่วนใน source ปัจจุบันแสดงเป็น mojibake ในไฟล์ที่อ่านผ่าน terminal ควรตรวจ encoding ให้เป็น UTF-8 ก่อนแก้ข้อความ UI

## 17. Operational Checklist

ก่อนวันสอบ:

- ตรวจ `data/roster-pr-2569.csv` ว่ามี 46 คน
- รัน `npm run seed:roster`
- เปลี่ยน admin/read-only password
- ตรวจพื้นที่ว่าง drive หลักและ backup มากกว่า 20 GB
- เปิด firewall port 8080
- lock IP server หรือทำ DHCP reservation
- build และติดตั้ง Windows Service
- เปิด `/admin` ดู dashboard
- upload QR Wi-Fi
- เปิด `/projector` และตรวจว่าไม่แสดงชื่อเต็ม
- ทดสอบ upload จากมือถือ/โน้ตบุ๊กหลายเครื่องใน LAN
- ทดสอบวิดีโอจริง ความยาวประมาณ 1 นาที
- ทดสอบ preview และ confirm
- ทดสอบ export manifest

ระหว่างสอบ:

- กรรมการ login admin
- กดเริ่ม timer
- เฝ้าดู status บน admin/projector
- หากผู้เข้าสอบมีปัญหา ให้ดู `errorMessage`
- หากจำเป็นต้องส่งใหม่หลัง confirm ให้ใช้ unlock พร้อมบันทึก reason
- หากต้องขยายเวลา ให้ใส่ reason เสมอ

หลังสอบ:

- กด export ใน admin หรือรัน `ops\export-now.ps1`
- เก็บ `exports` ทั้งจาก data root และ backup root
- สุ่มเปิด original/preview จากหลาย candidate
- เทียบ confirmation code และ SHA-256 ใน manifest
- สำรองทั้ง `D:\ExamSubmissions\PR-2569` และ `C:\ExamSubmissionsBackup\PR-2569`

## 18. Testing

คำสั่ง:

```powershell
npm test
npm run build
npm run check
```

Test ปัจจุบัน:

- `tests/core.test.js`
  - database default และ timer
  - public state ไม่เปิดเผยชื่อ
  - reject upload เมื่อ timer ไม่ running
  - settings/export manifest
  - media allow-list
- `tests/upload-flow.test.js`
  - สร้างวิดีโอ sample ด้วย ffmpeg
  - upload chunk
  - verify/transcode/confirm/backup

Test ใช้ runtime root ชั่วคราวใต้ `runtime/tests` และ override env:

- `EXAM_DATA_ROOT`
- `EXAM_BACKUP_ROOT`
- `UPLOAD_WORKS_DIR`
- `PUBLIC_URL`

## 19. Known Implementation Notes

- Backend เป็น JavaScript ESM แต่ frontend เป็น TypeScript
- TypeScript `tsconfig.json` include เฉพาะ `src`
- Vite build output คือ `dist/client`
- Server จะ serve frontend เฉพาะเมื่อ `dist/client` มีอยู่จริง
- SQLite ใช้ Node built-in `node:sqlite` จึงต้องใช้ Node version ที่รองรับ
- `ffmpeg-static` และ `ffprobe-static` เป็น dependency สำคัญของ verification flow
- `node-windows` ใช้ติดตั้ง service บน Windows เท่านั้น
- `logs/` ถูกสร้างไว้ แต่ Fastify logger ยังไม่ได้เขียนไฟล์ log โดยตรง
- `fileAccessTokens` เป็น in-memory map ไม่ persistent
- `_tmp` ยังไม่มี cleanup job อัตโนมัติหลัง assemble สำเร็จ ควรพิจารณาเพิ่มถ้าระบบใช้งานหลายรอบ

## 20. แนวทางแก้ไข/พัฒนาต่อ

เมื่อแก้ frontend:

- อัปเดต `src/types.ts` ถ้า payload เปลี่ยน
- อัปเดต `src/api.ts` ถ้า endpoint/contract เปลี่ยน
- ทดสอบหน้า `/`, `/submit`, `/admin`, `/projector`
- ตรวจ responsive และข้อความภาษาไทย
- อัปเดตเอกสารนี้ในหัวข้อ frontend/API ที่เกี่ยวข้อง

เมื่อแก้ backend:

- อัปเดต API reference ในเอกสารนี้
- อัปเดต test หรือเพิ่ม test สำหรับ behavior ใหม่
- ถ้าแก้ schema ให้เพิ่ม migration แบบ backward compatible ใน `server/db.js`
- ถ้าเพิ่ม status ใหม่ ให้อัปเดต `src/types.ts`, `utils.ts`, admin/projector display และ `statsFor()`
- ถ้าแก้ storage path ให้ตรวจ backup/export และ operational checklist

เมื่อแก้ upload/media:

- ทดสอบไฟล์จริงหลายชนิด
- ทดสอบวิดีโอที่มี/ไม่มี audio
- ทดสอบไฟล์ปลอม MIME ไม่ตรง extension
- ทดสอบไฟล์ใหญ่แบบหลาย chunk
- อัปเดต upload policy และ flow ในเอกสารนี้

เมื่อแก้ deployment:

- อัปเดต `ops/*.ps1`, `scripts/*service.js`, README และเอกสารนี้พร้อมกัน
- ทดสอบบน PowerShell Administrator
- ตรวจ firewall และ service restart

เมื่อแก้ security:

- อัปเดตหัวข้อ Authentication, Authorization, Security
- เพิ่ม audit log หากเป็น action สำคัญ
- เพิ่ม test สำหรับ permission

## 21. Definition of Done สำหรับการแก้ระบบ

งานแก้ไขถือว่าเสร็จเมื่อ:

- code build ผ่าน
- test ที่เกี่ยวข้องผ่าน
- manual flow สำคัญไม่พัง
- ไม่มีการลดการปกป้องข้อมูลผู้เข้าสอบโดยไม่ตั้งใจ
- เอกสารนี้อัปเดตตรงกับ behavior ล่าสุด
- ถ้าแก้ config/deploy ต้องอัปเดตคำสั่งใช้งานให้ตรง
- ถ้าแก้ API ต้องอัปเดต frontend types/client และ API reference

## 22. Change Log

ให้บันทึกทุกครั้งที่แก้ระบบหรือแก้เอกสารในรูปแบบ:

```text
YYYY-MM-DD - ผู้แก้ไข - สรุปการเปลี่ยนแปลง - ไฟล์/หัวข้อที่กระทบ - วิธี verify
```

รายการล่าสุด:

- 2026-05-01 - Codex - สร้าง system documentation ฉบับละเอียดสำหรับระบบทั้งหมด - เพิ่ม `SYSTEM_DOCUMENTATION.md` - ตรวจจากโครงสร้างโปรเจกต์, package scripts, server modules, frontend modules และ tests
- 2026-05-01 - Codex - อัปเดต metadata, วิธีใช้เอกสาร, baseline version และกติกา change log - แก้หัวเอกสารและเพิ่มหัวข้อ `0`, `22` - ตรวจว่าไฟล์เอกสารอยู่ที่ root project
- 2026-05-01 - Claude - UI redesign (presentation layer only, zero logic change) - `src/App.tsx`, `src/styles.css` - ตรวจด้วย npm run dev และเปิดทุก route; ไม่มี API/state/hook เปลี่ยน. CSS classes ใหม่: `.card-icon-box`, `.login-icon-wrap`, `.login-steps`, `.dropzone-wrap`, `.dropzone-hint`, `.qr-focal-wrap`, `.qr-header`, `.timer-pulse`, `.confirmation-icon`. QR code บน projector ถูก enlarge จาก max 108px → 280px (landscape) เพื่อ scan จากระยะไกลได้

## 23. Quick Reference สำหรับนักพัฒนาคนถัดไป

คำสั่งที่ใช้บ่อย:

```powershell
npm install
npm run dev
npm run build
npm test
npm run check
npm run seed:roster
npm run export:manifest
```

ไฟล์ที่ควรเปิดก่อนแก้แต่ละงาน:

- แก้ API/backend: `server/routes.js`, `server/db.js`, `server/state.js`, `server/upload.js`
- แก้หน้าจอผู้เข้าสอบ/admin/projector: `src/App.tsx`, `src/api.ts`, `src/types.ts`, `src/utils.ts`, `src/styles.css`
- แก้ config/path/policy: `server/config.js`
- แก้ export/backup: `server/exporter.js`
- แก้ media validation/preview: `server/media.js`
- แก้ deploy/service: `ops/*.ps1`, `scripts/install-service.js`, `scripts/uninstall-service.js`
- แก้รายชื่อผู้เข้าสอบ: `data/roster-pr-2569.csv`, `scripts/seed-roster.js`

สิ่งที่ต้องระวังเป็นพิเศษ:

- อย่าเปลี่ยน schema โดยไม่มี migration ที่รองรับ database เดิม
- อย่าเปิดเผยชื่อเต็มผู้เข้าสอบบน public/projector view
- อย่า bypass การตรวจ MIME จริงจาก content
- อย่าแก้ storage root โดยไม่ตรวจ backup/export path
- อย่าเปลี่ยน upload chunk size โดยไม่ตรวจ frontend `CHUNK_BYTES` และ backend `uploadPolicy.chunkBytes`
- อย่าเปลี่ยน submission status โดยไม่อัปเดต frontend type, label, tone, stats และเอกสารนี้
