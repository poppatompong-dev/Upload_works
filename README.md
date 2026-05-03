# ระบบส่งผลงานสอบปฏิบัติผู้ช่วยนักประชาสัมพันธ์

ระบบนี้รันบนเครื่องจริงภายใน LAN เท่านั้น ใช้สำหรับรับผลงานจากผู้เข้าสอบ 46 คน เก็บไฟล์หลักที่ `D:\ExamSubmissions\PR-2569` และสำรองที่ `C:\ExamSubmissionsBackup\PR-2569`

## URL หลัก

- ผู้เข้าสอบ: `http://<server-ip>:8080` หรือ `http://<server-ip>:8080/submit`
- กรรมการ: `http://<server-ip>:8080/admin`
- โปรเจคเตอร์: `http://<server-ip>:8080/projector`

ค่าเริ่มต้นรหัสผ่าน:

- admin: `admin2569`
- read-only: `view2569`

ควรเปลี่ยนผ่าน environment variables ก่อนวันสอบจริง: `EXAM_ADMIN_PASSWORD`, `EXAM_READONLY_PASSWORD`

## ติดตั้งและรัน

1. เปิด PowerShell แบบ Administrator
2. รัน `ops\open-firewall.ps1`
3. รัน `ops\install-service.ps1`
4. เปิด `http://<server-ip>:8080/admin` เพื่อตรวจ dashboard

ถ้าต้องรันแบบ console สำรอง ให้ใช้ `ops\start-console.ps1`

## Checklist ก่อนวันสอบ

- ตรวจรายชื่อใน `C:\Users\poppa\Documents\Upload_Works\roster\roster-pr-2569.csv` กับ PDF หน้า 9-10 อีกครั้ง
- ต่อ server ด้วยสาย LAN และล็อก IP หรือ DHCP reservation
- เปิด projector view และอัปโหลดรูป QR Wi-Fi จากหน้า admin
- ทดสอบมือถือ/โน้ตบุ๊กจริงอย่างน้อย 10-15 เครื่องบน Wi-Fi เทศบาล
- ทดสอบส่งวิดีโอจริง 1 นาที เปิด preview และกดยืนยัน
- ตรวจว่า projector ไม่แสดงชื่อเต็ม
- ตรวจว่าไฟล์ไปอยู่ทั้ง `D:\ExamSubmissions\PR-2569` และ `C:\ExamSubmissionsBackup\PR-2569`

## หลังสอบ

- กด Export ในหน้า admin หรือรัน `ops\export-now.ps1`
- เก็บโฟลเดอร์ `D:\ExamSubmissions\PR-2569\exports` และสำเนาใน `C:\ExamSubmissionsBackup\PR-2569\exports`
- สุ่มเปิดไฟล์ original และ preview MP4 จากหลายลำดับ แล้วเทียบรหัสยืนยัน/sha256 ใน manifest

## ล้างข้อมูลทดสอบก่อนวันจริง

- วิธีแนะนำ: login `/admin` ด้วย role admin แล้วกด `Clear Test Data`
- วิธี dev/script: `npm run clear:test-data`
- ระบบจะล้าง submissions, temp chunks, backup submissions และ reset สถานะส่งงาน แต่เก็บรายชื่อผู้เข้าสอบ, settings, timer, audit logs, exports, roster และ QR Wi-Fi ไว้
