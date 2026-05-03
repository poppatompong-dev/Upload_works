# System Documentation: NSM Practical Submission

**Document status:** Active source-of-truth for development and operations  
**Last updated:** 2026-05-03
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
| `EXAM_ADMIN_PASSWORD` | `admin2569` | password admin เริ่มต้น |
| `EXAM_READONLY_PASSWORD` | `view2569` | password read-only เริ่มต้น |
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

- `/`: `CandidatePage` (หน้า QR สำหรับผู้เข้าสอบเท่านั้น)
- `/portal`: `PortalPage` สำหรับทีมดูแลระบบใช้ตรวจลิงก์ภายในเท่านั้น ไม่ใช้เป็น QR สำหรับผู้เข้าสอบ
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

- lookup ด้วยลำดับที่หรือเลขประจำตัวสอบอย่างใดอย่างหนึ่ง เพื่อลดภาระผู้เข้าสอบ โดยไม่ส่งรายชื่อ/สถานะของผู้อื่นและไม่ส่งชื่อเต็มใน candidate/public flow
- หน้า `/submit` ใช้ `/api/public/submit-state` ที่ไม่มีรายชื่อ/สถานะของผู้เข้าสอบคนอื่น และ candidate lookup/detail ไม่ส่งชื่อเต็ม
- หน้า `/submit` poll สถานะเวลาเป็นระยะและมี fallback ไปอ่าน timer จาก `/api/public/state` เฉพาะกรณี backend เก่าหรือ endpoint ใหม่ยังไม่พร้อม เพื่อป้องกันอาการกรรมการเริ่มนับถอยหลังแล้วผู้เข้าสอบยังเห็นว่า “ยังไม่เริ่ม”
- เลือกหลายไฟล์ แต่ต้องมีวิดีโออย่างน้อย 1 ไฟล์
- frontend แบ่งไฟล์เป็น chunk ขนาด 4 MB
- upload ทีละ chunk ผ่าน `/api/upload-chunks`
- เปิด preview ผ่าน temporary file link
- ต้อง tick ยืนยันว่าเปิดดูตัวอย่างแล้วก่อน confirm
- หน้า `/` และ `/submit` ไม่แสดงลิงก์/เมนูสำหรับกรรมการ, settings หรือ projector เพื่อป้องกันผู้เข้าสอบสับสน

หน้าจอกรรมการ:

- login ได้ 2 role: `admin`, `readonly`
- admin แก้ settings, เริ่ม/หยุด/ขยายเวลา, unlock candidate, upload QR Wi-Fi, export และ clear test data ได้
- readonly ดูข้อมูลได้ แต่ไม่ควรแก้ไข state
- ดูรายชื่อทั้งหมดพร้อมชื่อเต็มและสถานะ
- เปิด preview ไฟล์ candidate ได้
- มี Smart Submission Report สำหรับเจ้าหน้าที่ดูรายงานหลายมิติ ได้แก่ สถานะระบบ, การยืนยัน, การตรวจไฟล์ และกลุ่มความเสี่ยง/ต้องติดตาม พร้อม KPI ผู้สอบยืนยัน, กรรมการรับรอง, รอกรรมการ และต้องติดตาม รวมถึง export CSV จากข้อมูล admin state ปัจจุบัน

หน้าจอ projector:

- `/projector` เป็น operational monitoring display สำหรับกรรมการและเจ้าหน้าที่ ไม่ใช่ instruction board
- แสดงโลโก้เทศบาลนครนครสวรรค์ใน header เพื่อยืนยัน branding ของงานสอบ
- ไม่แสดงคำชี้แจง, โจทย์, task description หรือข้อความแนะนำยาวบนจอ projector
- แสดง QR URL ระบบหลักใน panel ด้านขวา และแสดง QR Wi-Fi หาก admin upload แล้ว
- แสดง countdown, summary statistics, detailed submission/verification/confirmation status และ compact candidate status grid
- แสดงสถานะสำคัญ ได้แก่ total candidates, not started, uploading, verifying, ready to confirm, confirmed, needs resubmit และ admin unlocked
- เพิ่ม confirmation-focused metrics ได้แก่ confirmed count, confirmed percentage, ready-to-confirm count และ remaining unconfirmed count
- สีสถานะ projector แยกชัดเจนขึ้น: uploading สีส้ม, verifying สีฟ้า/cyan, ready-to-confirm สีม่วง, candidate confirmed สี teal, admin confirmed สีน้ำเงิน, confirmed สีเขียว, needs resubmit สีแดง และ admin unlocked สี indigo
- Realtime monitor มี 2 มุมมองคือ compact grid และอักษรวิ่ง พร้อม marker แยกสถานะผู้สอบยืนยัน (`ผ`) และกรรมการรับรอง (`ก`)
- กล่องเวลาบน projector ถูกยกเป็น panel แยกและกำหนดพื้นที่ header เพิ่ม เพื่อไม่ให้ถูกบดบังบน viewport 16:9 หลัก
- ไม่แสดงชื่อเต็มผู้เข้าสอบบน public/projector view เพื่อปกป้องข้อมูลส่วนบุคคล ใช้ลำดับและ applicant number/safe identifier เท่านั้น
- Layout ของ `/projector` อ้างอิง visual style จาก `intuitive-display-hub`: header/timer ด้านบน, operations panel ด้านซ้าย, realtime status grid กลาง, QR panel ด้านขวา และ bottom stat cards
- compact status grid แสดงผู้เข้าสอบ 46 คนครบใน viewport 16:9 หลัก (1920x1080, 1600x900, 1366x768, 1280x720) โดยเน้นลำดับ, applicant number, status label, progress percentage ขณะ uploading และ marker สำหรับ confirmed/needs resubmit
- มีปุ่ม/menu `Backup Drive` สำหรับเปิดช่องทาง Google Drive สำรอง พร้อมข้อความกำกับว่าใช้เฉพาะกรณีระบบหลักขัดข้องและเมื่อกรรมการแจ้งให้ใช้ โดยไม่แย่งความเด่นจาก QR ระบบหลัก

การรองรับวิดีโอ:

- frontend รับ `video/*` และนามสกุลวิดีโอทั่วไปจำนวนมาก เช่น MP4, MOV, MKV, AVI, WMV, WebM, MTS/M2TS, MXF, FLV, MPEG/MPG, 3GP, TS, VOB และกลุ่มใกล้เคียง
- backend ตรวจไฟล์จาก MIME/signature และ fallback จากนามสกุลวิดีโอ จากนั้นใช้ `ffprobe` ตรวจว่ามี video stream จริงก่อนรับรอง
- หากสร้าง preview MP4 ไม่สำเร็จ แต่ตรวจพบว่าเป็นวิดีโอจริง ระบบยังรับไฟล์ไว้และบันทึก warning แทนการ reject เพื่อรองรับวิดีโอหลากหลายที่สุดเท่าที่เครื่องมือ media pipeline อ่านได้

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

คืน public settings, QR URL, timer, stats, candidate status แบบไม่เปิดเผยชื่อเต็ม โดย `settings.publicUrl` สำหรับ QR จะถูก normalize ไปหน้า `/submit` เสมอเพื่อไม่ให้ QR ส่งผลงานพาไปหน้า public/status อื่นโดยไม่ตั้งใจ

`GET /api/public/submit-state`

คืนเฉพาะ settings และ timer สำหรับหน้า QR `/submit` ไม่มี `candidates`, `stats`, applicant list หรือสถานะของผู้เข้าสอบคนอื่น หน้า QR ส่งผลงานต้องใช้ endpoint นี้เท่านั้นเพื่อไม่ให้ผู้เข้าสอบเห็นข้อมูลผู้อื่น

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

`GET /api/admin/health`

- admin และ readonly เข้าได้
- คืนสถานะระบบสำหรับ preflight ก่อนสอบ
- ตรวจ: `dbWritable`, `backupWritable`, `ffmpegAvailable`, `ffprobeAvailable`, `rosterCount`, `disk`, `warnings`
- `ok: true` เมื่อทุก component พร้อมและ `rosterCount > 0`

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

สร้างไฟล์ 3 ชุดพร้อมสำรองไป backup root:
- `exam-manifest-<timestamp>.json` — snapshot ทั้งหมด
- `exam-summary-<timestamp>.csv` — รายชื่อ/สถานะต่อคน
- `audit-logs-<timestamp>.csv` — บันทึก activity ทั้งหมด (ทุก row ไม่จำกัด 500)

`POST /api/admin/reset-test-data`

ล้างข้อมูลทดสอบก่อนวันใช้งานจริง ต้องใช้ admin token เท่านั้น read-only ใช้ไม่ได้

Body:

```json
{ "confirm": "CLEAR TEST DATA", "includeExports": false, "includeBackups": true }
```

ผลลัพธ์:

- ลบ records ใน `files`
- reset ทุก row ใน `submissions` กลับเป็น `not_started`
- ล้าง `active_upload_id`, progress, timestamps, confirmation fields, error และ backup status/error ของ submissions
- ล้างโฟลเดอร์ `submissions/`, `_tmp/` และ backup `submissions/` ตามค่า default
- ถ้าส่ง `includeExports: true` จึงล้างโฟลเดอร์ `exports/`
- ถ้าส่ง `includeBackups: false` จะไม่ล้าง backup submissions
- เก็บ `candidates`, `settings`, `sessions`, `audit_logs`, `timer`, `exports`, `Upload_Works/roster`, `Upload_Works/assets` ไว้ตามค่า default และเขียน audit log action `test_data_cleared`

### Candidate

`POST /api/candidates/lookup`

Body:

```json
{ "identifier": "1" }
```

ค้นได้ด้วยเลขใดเลขหนึ่ง:

- `sequence_no`
- `applicant_no`
- รองรับเลขไทยโดย normalize เป็นเลขอารบิก

คืน candidate token และ candidate detail เฉพาะรายนั้น โดยไม่ส่งชื่อเต็มใน candidate/public flow

`GET /api/candidates/:id`

ต้องใช้ candidate token ของ id เดียวกัน และไม่ส่งชื่อเต็มใน candidate/public flow

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
- **ถ้า hash ตรงกับค่า default ระบบจะแสดง warning ใน system warnings** ของทั้ง publicState และ adminState

Login rate limiting:

- `/api/auth/login` มี rate limit: **5 ครั้งต่อ IP → lockout 10 นาที**
- ระหว่าง lockout คืน HTTP 429 พร้อมเวลาที่ต้องรอ (ภาษาไทย)
- ทุก login fail บันทึกเป็น `login_failed` (level: warning) พร้อม attempt count
- lockout บันทึกเป็น `login_rate_limited` (level: warning)
- login สำเร็จ reset counter ของ IP นั้น
- rate limit เก็บใน memory (reset เมื่อ server restart)

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
- `_tmp` มี cleanup 3 ระดับ: (1) ลบ chunkDir ทันทีหลัง `assembleFile()` สำเร็จ (2) ลบ uploadId เดิมเมื่อ candidate เริ่ม session ใหม่ (3) `cleanupStaleTemp()` ลบ orphaned dirs ตอน bootstrap

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

- 2026-05-03 - Codex - เพิ่ม Smart Admin Action Drilldown ในเมนู `ภาพรวม`: card งานด่วนเปิดรายการผู้เข้าสอบในกลุ่มนั้นใต้ card ได้ทันที, ค่าเริ่มต้นโฟกัส `รอกรรมการยืนยัน`, คลิกรายการแล้วเปิด inspector ตรวจไฟล์/preview/ยืนยันในหน้าเดียวกันโดยไม่ต้องไปเมนูผู้เข้าสอบ, และอัปเดตเอกสาร workflow ผู้ดูแลระบบวันสอบจริง - `src/App.tsx`, `src/styles.css`, `SYSTEM_DOCUMENTATION.md` - verify ด้วย npm run build, npm test, npm run check
- 2026-05-03 - Codex - ตรวจ readiness ก่อนสอบจริงและปรับ UI operational รอบสุดท้าย: ตรวจสเปกเครื่อง/Node/npm/ffmpeg/พื้นที่ดิสก์, ยืนยันว่าไม่ต้องติดตั้ง software เพิ่ม, ปรับหน้า admin เป็น SPA sidebar แสดงทีละหมวดเพื่อลด scroll, เปลี่ยนงานด่วนเป็น card สรุป 4 กลุ่มพร้อมเปิดรายถัดไป, แก้ Projector Insight Data ไม่ให้เกิด internal scroll, เพิ่ม QR code ใน Backup Drive modal, และอัปเดตเอกสาร production readiness/checklist - `src/App.tsx`, `src/styles.css`, `SYSTEM_DOCUMENTATION.md` - verify ด้วย npm run build, npm test, ตรวจ `/api/public/qr`, ตรวจ remote `origin`
- 2026-05-03 - Codex - แก้หน้า admin inspector สำหรับจัดการผู้เข้าสอบ: เพิ่มปุ่ม `กลับไปรายชื่อ` เพื่อเคลียร์ผู้สอบที่เลือกและเลือกคนอื่นต่อได้, ปรับปุ่มบันทึกข้อมูลผู้สอบให้ validate ค่าและแสดงสถานะกำลังบันทึก, ปิดฟอร์มแก้ไขหลัง save สำเร็จ, และเพิ่ม test สำหรับ `PATCH /api/admin/candidates/:id` - `src/App.tsx`, `src/styles.css`, `tests/core.test.js`, `SYSTEM_DOCUMENTATION.md` - verify ด้วย npm run check
- 2026-05-03 - Codex - ปิดงาน privacy flow หน้า `/submit` ให้ตรงกับเอกสาร: `/api/public/submit-state` คืนเฉพาะ settings/timer โดยไม่ส่ง `candidates` หรือ `stats`, candidate lookup/detail ไม่ส่ง `fullName`/`note` ใน public flow, หน้า CandidatePage เปลี่ยนจากรายการชื่อกลับเป็นช่องกรอกลำดับที่หรือเลขประจำตัวสอบ, หลักฐานยืนยันไม่พิมพ์ชื่อเต็ม, และเพิ่ม test กัน regression ไม่ให้ public/candidate endpoint เปิดเผยชื่อเต็ม - `server/state.js`, `server/routes.js`, `src/App.tsx`, `src/api.ts`, `src/types.ts`, `src/styles.css`, `tests/core.test.js`, `SYSTEM_DOCUMENTATION.md` - verify ด้วย npm run build, npm test, npm run check
- 2026-05-02 - Codex - Hotfix หน้า `/submit` ไม่เห็น timer หลังกรรมการเริ่มสอบ: เพิ่ม polling ทุก 2 วินาทีใน CandidatePage, เพิ่ม fallback ของ API client จาก `/api/public/submit-state` ไปอ่านเฉพาะ settings/timer จาก `/api/public/state` เมื่อ backend เก่ายังไม่มี endpoint ใหม่, และเพิ่ม test ว่าเมื่อ admin start timer แล้ว `/api/public/submit-state` ต้องคืน `timer.state=running` พร้อม `remainingSeconds > 0` - `src/App.tsx`, `src/api.ts`, `tests/core.test.js`, `SYSTEM_DOCUMENTATION.md` - verify ด้วย npm run build, npm test, npm run check
- 2026-05-02 - Codex - ปรับ projector/admin reporting ตาม feedback ภาพหน้าจอ: แยกสีสถานะให้ต่างชัดขึ้น, แก้กล่องเวลาบน projector ไม่ให้ถูกบดบัง, เปลี่ยนภาพรวม projector เป็นภาษาไทย, เพิ่มมุมมองอักษรวิ่งใน Realtime monitor พร้อม marker ผู้สอบยืนยัน/กรรมการรับรอง, เพิ่ม Smart Submission Report ในหน้า admin สำหรับดูรายงานหลายมิติและ export CSV, และคืนหน้า `/submit` ให้ lookup ด้วยลำดับที่หรือเลขประจำตัวสอบอย่างใดอย่างหนึ่งโดยยังไม่ส่งชื่อเต็มหรือข้อมูลผู้อื่น - `src/App.tsx`, `src/api.ts`, `src/styles.css`, `src/utils.ts`, `server/routes.js`, `tests/core.test.js`, `SYSTEM_DOCUMENTATION.md` - verify ด้วย npm run build, npm test, npm run check
- 2026-05-02 - Codex - Harden QR `/submit` privacy: เพิ่ม `/api/public/submit-state` สำหรับหน้า QR โดยไม่ส่ง `candidates`/`stats`/รายชื่อหรือสถานะของผู้อื่น, บังคับ QR URL ให้ resolve ไป `/submit` เสมอ, เปลี่ยน CandidatePage ให้ใช้ endpoint นี้แทน `/api/public/state`, และเปลี่ยน candidate lookup/detail ไม่ให้ส่งหรือแสดงชื่อเต็มใน candidate/public flow; admin/projector behavior ยังใช้ state เดิมตามสิทธิ์และไม่แสดงชื่อเต็มบน projector - `server/state.js`, `server/routes.js`, `src/api.ts`, `src/types.ts`, `src/App.tsx`, `tests/core.test.js`, `SYSTEM_DOCUMENTATION.md` - verify ด้วย npm run build, npm test, npm run check
- 2026-05-02 - Codex - เพิ่มโลโก้เทศบาลใน UI และขยาย video compatibility: สร้าง asset `public/municipality-logo.png` จากไฟล์โลโก้ต้นฉบับ, แสดงโลโก้บน portal/candidate/projector header, ขยาย frontend accept list และ server media classification ให้รองรับนามสกุลวิดีโอหลากหลาย, ใช้ `ffprobe` ยืนยัน video stream, และให้ระบบรับไฟล์วิดีโอไว้พร้อม warning หากสร้าง preview MP4 ไม่สำเร็จแทนการ reject; ตรวจ Google Drive fallback folder แล้วพบว่าว่าง แต่ connector ที่มีใน session นี้ไม่มีคำสั่ง create folder โดยตรง - `public/municipality-logo.png`, `src/App.tsx`, `src/styles.css`, `src/utils.ts`, `server/media.js`, `server/upload.js`, `server/routes.js`, `tests/core.test.js`, `SYSTEM_DOCUMENTATION.md` - verify ด้วย npm run build, npm test, npm run check
- 2026-05-02 - Codex - Redesign `/projector` ตาม reference `intuitive-display-hub`: เปลี่ยนจาก instruction board เป็น operational monitoring display, เอา task description/คำชี้แจง/ข้อความแนะนำยาวออกจาก projector, เพิ่ม detailed submission/verification/confirmation status, confirmation metrics, status overview ครบทุกสถานะ, compact 46-candidate grid พร้อม progress/confirmation/warning marker, เพิ่ม panel QR ระบบหลัก + QR Wi-Fi และเมนู Google Drive fallback สำหรับ emergency upload โดยไม่แสดงชื่อเต็มผู้เข้าสอบและไม่เปลี่ยน backend/API/auth/upload/database/realtime behavior - `src/App.tsx`, `src/styles.css`, `SYSTEM_DOCUMENTATION.md` - verify ด้วย npm run build, npm test, npm run check และ responsive screenshot/manual layout checks 1920x1080, 1600x900, 1366x768, 1280x720
- 2026-05-02 - Codex - Projector information hierarchy redesign: ปรับเฉพาะหน้า `/projector` เป็น layout เดียวสำหรับจอฉายจริง โดยให้คำชี้แจงและ compact status grid มีน้ำหนักเท่ากัน, เอาปุ่ม view mode ออกจากหน้าจอฉาย, ย้าย dashboard และ QR ลง bottom bar, แสดงผู้เข้าสอบ 46 คนครบโดยไม่ scroll ใน viewport 1920x1080, 1600x900, 1366x768, 1280x720, ลด QR เป็น secondary แต่ยัง scan ได้, ไม่แสดงชื่อเต็มผู้เข้าสอบ และไม่มี backend/API/auth/upload/realtime/business logic change - `src/App.tsx`, `src/styles.css`, `SYSTEM_DOCUMENTATION.md` - verify ด้วย npm run build, npm test, npm run check และ headless screenshots 4 viewport
- 2026-05-02 - Codex - Final hotfix หน้า `/projector`: คืน primary theme เป็น violet/purple, แก้ grid/flex height และ overflow สำหรับ viewport 1920x1080, 1600x900, 1366x768, 1280x720, เพิ่ม internal scroll เฉพาะ status panel เมื่อรายชื่อยาว, ปรับ QR/timer/instructions ให้ไม่ถูกตัด และยืนยันว่า public/projector ไม่ render ชื่อเต็มผู้เข้าสอบ; ไม่มี API/backend/auth/upload/realtime/business logic change - `src/styles.css`, `src/App.tsx`, `SYSTEM_DOCUMENTATION.md` - verify ด้วย npm run build, npm test, npm run check
- 2026-05-02 - Codex - UI polish รอบเตรียมใช้งานจริงตาม frontend-design skill: เปลี่ยน visual direction เป็น refined civic operations ลดธีมม่วงเดิม, ปรับ design tokens เป็น teal/ink/gold, เพิ่มความชัดของ hero/panel/button/table/stat card/projector instructions โดยไม่เปลี่ยน API หรือ workflow - `src/styles.css`, `SYSTEM_DOCUMENTATION.md` - verify ด้วย npm run build และ npm test
- 2026-05-02 - Codex - เพิ่ม Data & File Reset Utility และปรับ QR/examinee view: (1) เพิ่ม `server/reset.js` และ `scripts/clear-test-data.js` สำหรับล้างไฟล์ทดสอบ/สถานะ upload โดยเก็บ roster/settings (2) เพิ่ม `POST /api/admin/reset-test-data` เฉพาะ admin พร้อม confirm phrase และ audit log `test_data_cleared` (3) เพิ่มปุ่ม Clear Test Data ในหน้า admin และ API client (4) ปรับ `/` เป็นหน้า `CandidatePage`, ย้าย portal รวมไป `/portal`, และให้ QR URL auto-resolve ไป `/submit` (5) หน้า candidate ไม่แสดงเมนู admin/projector/settings - `server/reset.js`, `server/routes.js`, `server/state.js`, `scripts/clear-test-data.js`, `src/App.tsx`, `src/api.ts`, `src/styles.css`, `tests/core.test.js`, `SYSTEM_DOCUMENTATION.md` - verify ด้วย npm run build และ npm test
- 2026-05-01 - Codex - สร้าง system documentation ฉบับละเอียดสำหรับระบบทั้งหมด - เพิ่ม `SYSTEM_DOCUMENTATION.md` - ตรวจจากโครงสร้างโปรเจกต์, package scripts, server modules, frontend modules และ tests
- 2026-05-01 - Codex - อัปเดต metadata, วิธีใช้เอกสาร, baseline version และกติกา change log - แก้หัวเอกสารและเพิ่มหัวข้อ `0`, `22` - ตรวจว่าไฟล์เอกสารอยู่ที่ root project
- 2026-05-01 - Claude - UI redesign (presentation layer only, zero logic change) - `src/App.tsx`, `src/styles.css` - ตรวจด้วย npm run dev และเปิดทุก route; ไม่มี API/state/hook เปลี่ยน. CSS classes ใหม่: `.card-icon-box`, `.login-icon-wrap`, `.login-steps`, `.dropzone-wrap`, `.dropzone-hint`, `.qr-focal-wrap`, `.qr-header`, `.timer-pulse`, `.confirmation-icon`. QR code บน projector ถูก enlarge จาก max 108px → 280px (landscape) เพื่อ scan จากระยะไกลได้
- 2026-05-02 - Claude - Security & reliability: (1) _tmp cleanup 3 ระดับ (2) Admin health endpoint `/api/admin/health` (3) Audit log CSV ใน export (4) Login rate limit 5 ครั้ง/10 นาที ต่อ IP (5) Warning เมื่อใช้ default password - `server/upload.js`, `server/index.js`, `server/state.js`, `server/routes.js`, `server/exporter.js`, `SYSTEM_DOCUMENTATION.md` - npm run build ✅ npm test 9/9 ✅
- 2026-05-02 - Claude - แก้ timer hardcode: `startPracticalExam()` และ `restartPracticalExam()` ดึง `durationSeconds` จาก `state.settings` แทน hardcode 3600 — ข้อความยืนยันแสดงจำนวนนาทีจริง - `src/App.tsx` - npm run check ✅
- 2026-05-02 - Claude - UI redesign สี: เปลี่ยน primary color จาก teal (#087f75) เป็นม่วง (#6d28d9 / Violet) ครบทุก component — CSS variables ใหม่: `--primary`, `--primary-light`, `--primary-deep` แทน `--teal*`; admin sidebar เป็น dark purple gradient; projector instructions เป็น purple gradient พร้อม high-contrast border; page background เป็น purple tint; ไม่มีการเปลี่ยน logic/HTML - `src/styles.css` - npm run build ✅ npm test 9/9 ✅
- 2026-05-02 - Claude - แก้ QR code ใช้ IP เก่า: แยก `publicUrlCustom` (ค่า raw จาก DB) ออกจาก `publicUrl` (resolved) — settings form ตอนนี้ init จาก `publicUrlCustom` (ว่างเปล่าถ้าไม่เคยตั้งค่า) แทนที่จะเอา resolved URL ไปบันทึกลง DB; แสดง hint "ตรวจพบอัตโนมัติ: http://..." ใต้ช่องกรอก; ปล่อยว่าง = auto-detect ทุกครั้ง - `server/state.js`, `src/types.ts`, `src/App.tsx` - npm run build ✅ npm test 9/9 ✅
- 2026-05-02 - Claude - แก้ layout การจัดพื้นที่และการวางตำแหน่ง (CSS only): (1) `.admin-toolbar` เปลี่ยนจาก 2-col grid เป็น flex-column — stat cards full-width row บน ปุ่มทุกตัว full-width row ล่าง ไม่ wrap ซ้อนกันอีก (2) `.admin-sidebar > button` (logout) ใช้ `margin-top: auto` ชิดก้น sidebar — reset เป็น 0 เมื่อ collapse ที่ tablet (3) `.admin-grid` เปลี่ยน inspector column เป็น `clamp(300px, 32vw, 440px)` และเพิ่ม `align-items: start` ให้ inspector ไม่ stretch สูงเท่า table (4) `.candidate-grid` เปลี่ยนเป็น `clamp(260px, 36%, 360px) 1fr` — identity panel มี floor ที่ 260px (5) `.table-wrap` ความสูง responsive `clamp(480px, 55vh, 720px)` แทน fixed 620px - `src/styles.css` - npm run build ✅

## 23. Quick Reference สำหรับนักพัฒนาคนถัดไป

คำสั่งที่ใช้บ่อย:

```powershell
npm install
npm run dev
npm run build
npm test
npm run check
npm run seed:roster
npm run clear:test-data
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

## 24. Production Readiness Snapshot: 2026-05-03

ผลตรวจเครื่องก่อนใช้งานจริง:

- OS: Microsoft Windows 11 Home 64-bit, version 10.0.26200
- CPU: Intel(R) Core(TM) Ultra 9 285, 24 cores / 24 logical processors
- RAM: ประมาณ 64 GB, ตอนตรวจเหลือว่างประมาณ 50 GB
- Disk C: NTFS ขนาดประมาณ 999 GB, เหลือว่างประมาณ 874 GB
- Disk D: NTFS ขนาดประมาณ 1000 GB, เหลือว่างประมาณ 999 GB
- Node.js: v24.15.0
- npm: 11.12.1
- `node_modules` ติดตั้งครบ
- `ffmpeg-static` และ `ffprobe-static` พบ executable ครบ
- server ฟังพอร์ต `0.0.0.0:8080`
- Vite dev server ใช้ `5173` หรือพอร์ตถัดไปเมื่อ `5173` ถูกใช้

สรุป readiness:

- เครื่องมี CPU/RAM/พื้นที่ดิสก์เพียงพอมากสำหรับสนามสอบประมาณ 46 คน
- ไม่จำเป็นต้องติดตั้ง software เพิ่ม ณ เวลาตรวจ
- จุดเสี่ยงหลักไม่ใช่สเปกเครื่อง แต่เป็น Wi-Fi/AP, firewall, IP เครื่อง server, และการอัปโหลดพร้อมกันช่วงท้ายเวลา

ค่าที่ตั้งไว้ล่าสุด:

- URL ส่งงาน: `http://192.168.8.43:8080/submit`
- Wi-Fi SSID: `@Communication`
- Wi-Fi Password: `VoIPvy,ibomiN`
- เวลาสอบ: `3600` วินาที
- หน่วยงาน: `เทศบาลนครนครสวรรค์`
- ตำแหน่ง: `ผู้ช่วยนักประชาสัมพันธ์`

Checklist ก่อนวันสอบจริง:

- ต่อเครื่อง server ด้วย LAN ถ้าเป็นไปได้
- ยืนยันว่า IP เครื่องยังเป็น `192.168.8.43`; ถ้าเปลี่ยนให้แก้ `publicUrl` ในหน้า admin
- เปิด firewall ให้เครื่องอื่นเข้า `http://<server-ip>:8080/submit`
- ทดสอบจากมือถือผู้สอบอย่างน้อย 2-3 เครื่องบน Wi-Fi จริง
- เปิด `/projector` บนจอฉายและตรวจว่ามองเห็นสถานะครบ 46 คน
- เปิด `/admin` และ login admin/read-only
- ทดลองอัปโหลดไฟล์จริง 2-3 ไฟล์ พร้อมเปิด preview และกดยืนยัน
- ตรวจพื้นที่ว่าง D: และ C: ก่อนเริ่มสอบ
- ห้ามกด `Clear Test Data` หลังเริ่มสอบจริง ยกเว้นยืนยันว่ากำลังล้างข้อมูลทดสอบก่อนวันสอบ

## 25. UI Operation Notes: Admin SPA + Projector + Backup

### Admin SPA Sidebar

หน้า `/admin` ปรับเป็น SPA sidebar:

- `ภาพรวม`: แสดง stat cards และ card งานด่วน
- `ผู้เข้าสอบ`: แสดงตารางผู้เข้าสอบและ inspector สำหรับเปิดดูไฟล์/preview/ยืนยัน/แก้ข้อมูล
- `ตั้งค่า`: แก้หัวข้อสอบ, หน่วยงาน, ตำแหน่ง, URL, Wi-Fi, รหัสผ่าน และอัปโหลด QR Wi-Fi
- `รายงาน`: สรุปสถานะ, export CSV, พิมพ์รายงาน PDF, พิมพ์บัตรโต๊ะ
- `Logs`: ไปหน้า Activity Logs แยก

Card งานด่วนแบ่งเป็น:

- `ส่งงานมาแล้ว`: ผู้สอบที่อัปโหลดผ่านและเข้าขั้นยืนยัน/รับรอง
- `รอการตรวจสอบ`: งานที่กำลังอัปโหลดหรือระบบกำลัง verify
- `รอกรรมการยืนยัน`: งานที่ควรให้กรรมการเปิดดูและยืนยันโดยเร็ว
- `ต้องติดตาม`: งาน error, needs resubmit, หรือเปิดสิทธิ์ใหม่

พฤติกรรมของ card งานด่วน:

- ค่าเริ่มต้นของแผงงานด่วนโฟกัสที่ `รอกรรมการยืนยัน`
- เมื่อกด card ใด ระบบจะแสดงรายการผู้เข้าสอบในกลุ่มนั้นใต้ card ทันที
- ไม่ต้องไปเมนู `ผู้เข้าสอบ` เพื่อค้นหาด้วยตนเอง
- รายการใน drilldown แสดงลำดับ, เลขประจำตัวสอบ, ชื่อ-นามสกุล และสถานะปัจจุบัน
- เมื่อกดรายการ ระบบเปิด inspector ตรวจไฟล์ในหน้า `ภาพรวม` ทันที
- inspector ในหน้า `ภาพรวม` ใช้ workflow เดียวกับเมนู `ผู้เข้าสอบ`: เปิด preview, ยืนยันโดยกรรมการ, เปิดสิทธิ์ส่งใหม่, แก้ข้อมูลผู้เข้าสอบ

การใช้งานที่เร็วที่สุดของกรรมการ:

1. เปิด `/admin`
2. อยู่ที่เมนู `ภาพรวม`
3. ดู card `รอกรรมการยืนยัน`
4. กด card เพื่อเปิดรายการที่ต้องยืนยัน
5. กดชื่อผู้เข้าสอบในรายการ
6. เปิด preview ใน inspector ที่แสดงใต้แผงงานด่วน
7. กดรับรองเมื่อไฟล์เปิดดูถูกต้อง
8. กลับไปกดรายการถัดไปใน drilldown ได้ทันที

### Projector

หน้า `/projector` เป็นจอแสดงผลรวม:

- ไม่แสดงชื่อเต็มผู้เข้าสอบ
- แสดงสถานะ real-time เป็น compact grid ขนาดใหญ่ขึ้น
- Insight Data ถูกปรับให้ไม่เบียดและไม่เกิด scroll ภายในแผงซ้าย
- เอา QR Wi-Fi ออกจาก Projector เพราะมีอยู่บนบัตรโต๊ะแล้ว
- `Backup Drive` เปิด modal พร้อม QR code ไปยัง Google Drive สำรอง

### Backup Drive Modal

ปุ่ม `Backup Drive` บน Projector:

- แสดงลิงก์ Google Drive สำรอง
- แสดง QR code ของ Google Drive
- ใช้เฉพาะเมื่อระบบหลักมีปัญหาและกรรมการประกาศให้ใช้
- หากใช้ช่องทางนี้ ให้ผู้สอบตั้งชื่อไฟล์ด้วยลำดับหรือเลขประจำตัวสอบก่อนอัปโหลด

### บัตรโต๊ะ

บัตรโต๊ะประกอบด้วย:

- ลำดับผู้สอบ
- เลขประจำตัวสอบ
- ชื่อ-นามสกุล
- QR ส่งงานรายบุคคล
- QR Wi-Fi
- SSID และรหัส Wi-Fi สำหรับกรณีอุปกรณ์ไม่มีกล้องหรือสแกนไม่ได้
- คำแนะนำสั้น: ส่งแล้วต้องเปิดดู preview, ดูแล้วต้องกดยืนยัน, ยืนยันแล้วสามารถบันทึกหลักฐาน
