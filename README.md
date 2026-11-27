# SiteLens — Platform Monitoring & Pengendalian Progres Proyek Generic

[![Vibe-Shield Security](https://img.shields.io/badge/Vibe--Shield-Grade_A%2B-10b981)](https://github.com/avivgerz-hue/vibe-shield)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-0.45-C5F74F.svg)](https://orm.drizzle.team/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791.svg)](https://www.postgresql.org/)

SiteLens adalah platform **Project Progress Monitoring & Control Generic** (dapat diterapkan untuk konstruksi sipil, EPC, instalasi MEP, manufaktur, maupun rekayasa teknologi) yang dirancang untuk menjamin **validitas progres fisik pekerjaan (*verifiable physical progress*)** dan mengeliminasi keterlambatan akibat penyumbatan birokrasi inspeksi teknis (*inspection bottleneck*).

Platform ini menempatkan **inspeksi lapangan, checklist mutu/K3, dan dokumen pendukung sebagai bukti validasi progres**, bukan pusat sistem yang terisolasi. Progres pekerjaan diukur berbasis pohon struktur rincian kerja (**Work Breakdown Structure / WBS**) dengan prinsip **four-eyes principle** dan pencegahan klaim sepihak: *pekerjaan tidak dapat diakui selesai secara sepihak sebelum lolos verifikasi mutu independen dan bebas dari temuan cacat kritis terbuka*.

---

## 📚 Dokumentasi Acuan

* 📋 **Audit Menyeluruh & Status Proyek (17 Bab):** [docs/AUDIT_DAN_STATUS_PROYEK_2026.md](file:///c:/Users/Programer/Documents/SiteLens/docs/AUDIT_DAN_STATUS_PROYEK_2026.md)
* 🎯 **Product Requirements Document (PRD Piloting v1.1):** [docs/PRD_PILOTING_v1.0.md](file:///c:/Users/Programer/Documents/SiteLens/docs/PRD_PILOTING_v1.0.md)

---

## 🚀 Status Implementasi Komponen (Faktual Hasil Audit)

Berdasarkan audit menyeluruh pada codebase (November 2026), berikut adalah status riil komponen sistem:

| Modul / Kemampuan | Status Implementasi | Deskripsi & Lokasi Kode |
| :--- | :---: | :--- |
| **Project Setup Studio & WBS Tree** | **AKTIF** | Pengelolaan pohon WBS berbobot (`work_nodes`), preset EPC/Civil/Blank (`ProjectSetupStudio.tsx:41`), validasi total bobot $100\%$ non-blocking, referensi dokumen gambar acuan. |
| **Kurva-S Kalender Baku** | **AKTIF** | Pemotongan mingguan Senin 00:00 – Minggu 23:59 (`scurve.ts:51`), komparasi Target Timeline vs Verified Physical Progress, dukungan manual override oleh PM (`planned_curve_overrides`). |
| **Stage Workflow & Four-Eyes Gate** | **AKTIF** | Tahapan `work`, `hold`, `review` (`schema.ts:162`), pencegahan self-approval (`server.ts:474`), dual-track signature (stempel canvas touch + unggah berkas scan basah di `StageCard.tsx:44`). |
| **Bottleneck Radar & SLA Aging** | **AKTIF** | Indikator keterlambatan approval: Normal (<24h), Warning (24–48h), Critical Bottleneck (>48h) berbasis durasi pengajuan RFI (`scurve.ts:251`). |
| **Log Cuaca Harian & Analisis EOT** | **AKTIF** | Pencatatan jam hujan harian (`weather_logs`), analisis korelasi deviasi kurva S dengan dampak cuaca ekstrem untuk justifikasi *Extension of Time* (`weather.ts`). |
| **Otentikasi & Keamanan** | **AKTIF** | Argon2id password hashing, WebAuthn Passkey FIDO2/biometrik (`crypto.ts`), Session cookie HttpOnly, audit log mutasi (`audit_logs`), Grade A+ Vibe-Shield. |
| **Kepatuhan K3 & AI Generator** | **AKTIF** | Modul SMK3 PP 50/2012 & B3 Kepmenaker 187/1999 (`tenant.ts`), AI Checklist Template Generator via Google Gemini (`AITemplateGeneratorModal.tsx`). |
| **PWA Offline Checklist & Foto** | **AKTIF (PARSIAL)** | Form inspeksi lama tersimpan di IndexedDB (`idbService.ts`) dengan SHA-256 photo hash. **Catatan:** Pengajuan attempt WBS saat ini masih menggunakan RAM lokal (`wbsDemoStore`) dan perlu dimigrasikan ke IndexedDB. |
| **Integrasi CAPA/Temuan ke WBS** | **DALAM TRANSISI** | Tabel `corrective_actions` aktif namun belum memiliki relasi FK `node_id`. Logika pengunci S-Curve 99% saat ini membaca tabel `punchlist_items` yang sedang dalam tahap konsolidasi. |
| **Keanggotaan Per-Proyek (`project_members`)** | **DALAM TRANSISI** | Tabel relasi multi-user per-proyek sudah ada di skema (`schema.ts:227`), namun otorisasi aktif masih membaca peran global `users.role`. Transisi ke *scoped project membership* sedang berjalan. |
| **Pengaturan Global & Kop Surat PDF** | **AKTIF (PRODUKSI)** | Pengaturan identitas korporat (`company_settings`), unggah logo perusahaan resmi (PNG/JPEG/JPG), pratinjau kop surat live, dan integrasi otomatis kop surat pada seluruh ekspor PDF (`exportBlankChecklistPdf` & `exportFilledInspectionPdf`). |
| **Manajemen Tim Organisasi Global** | **AKTIF (PRODUKSI)** | Menu permanen navigasi sidebar (`TeamManagement.tsx`), standardisasi role konstruksi sipil & EPC, kontrol status akun aktif/nonaktif, opsi reset sandi, dan pembatasan switch user aman. |
| **Log Audit Keamanan & Server Pagination** | **AKTIF (PRODUKSI)** | Pencatatan mutasi keamanan terpadu (`audit_logs`), filtering pencarian SQL (`ilike`), dan pagination server-side berbasis database di tab Audit Pengaturan. |
| **Ekspor Laporan Resmi** | **AKTIF (PRODUKSI)** | Ekspor blanko checklist kosong lapangan, ekspor laporan hasil inspeksi bersertifikat (dilengkapi tanda tangan & foto bukti) dengan kop surat resmi korporat, ekspor laporan mingguan PDF, dan ekspor CSV. |
| **BAPP Generator & 2D Drawing Defect Pinning** | **BELUM ADA** | Direncanakan pada roadmap fase lanjutan pasca-konsolidasi database. |

---

## 👥 Model Peran (RBAC & Four-Eyes Principle)

SiteLens menerapkan pemisahan tugas (*separation of duties*) untuk menjamin integritas data lapangan:

1. **`Project Director & Tenant Admin`**  
   Memonitor performa makro Kurva-S, mengesahkan *planned curve overrides*, mengelola pengguna sistem, mengawasi *Bottleneck Radar*, dan mengunduh laporan resmi.
2. **`Project / Site Engineer`**  
   Menyusun struktur WBS dan pembobotan pada Project Setup Studio, memantau target jadwal, dan mengajukan permintaan inspeksi (*Request for Inspection / RFI*). *Dilarang menyetujui RFI yang diajukannya sendiri.*
3. **`QA/QC Lead / Owner Inspector`**  
   Melakukan review independen, menandatangani gerbang persetujuan tahap kerja (*four-eyes check*), dan memvalidasi penutupan temuan ketidaksesuaian/CAPA.
4. **`Field / QC Inspector`**  
   Menjalankan inspeksi teknis di lapangan (mendukung PWA offline di area blind spot), merekam bukti foto bertanda waktu SHA-256, dan menerbitkan temuan ketidaksesuaian (*punchlist*).
5. **`Action Owner / Subcontractor`**  
   Menerima disposisi perbaikan temuan cacat/CAPA, memperbarui progres perbaikan fisik, dan mengunggah bukti perbaikan. *Dilarang keras memverifikasi atau menutup temuannya sendiri.*
6. **`Client / Vendor Viewer`**  
   Mengakses dasbor Kurva-S, status WBS, dan riwayat laporan terverifikasi dengan hak akses baca ketat (*read-only*).

---

## 🛠️ Tech Stack & Arsitektur

* **Frontend:** React 19, Vite 8, Tailwind CSS v4, Motion, Lucide Icons, `jspdf`, `tesseract.js` (OCR), `idb` (IndexedDB offline store), `vite-plugin-pwa` (Workbox Service Worker).
* **Backend:** Node.js 22 (`tsx`), Express 4, Drizzle ORM, PostgreSQL 16, `@simplewebauthn` (Passkey/FIDO2), `argon2`, `nodemailer` (SMTP alerts).
* **Infrastruktur & Deployment:** Docker Compose multi-container (`app`, `postgres`, `caddy` reverse-proxy dengan TLS otomatis).

```
[Klien PWA Offline / Browser]
       │
       ▼ (HTTPS / TLS)
[Caddy Reverse Proxy]
       │
       ▼ (Port 3000)
[Express Application Server]
   ├── Session & RBAC Middleware
   ├── WBS & S-Curve Calculation Engine (`src/server/scurve.ts`)
   ├── Inspection & Dual-Track Approval Controller
   └── Weather & EOT Logger
       │
       ▼ (Connection Pool)
[PostgreSQL Database] (20 Entitas Drizzle ORM, termasuk company_settings)
```

---

## ⚡ Panduan Cepat (Quick Start)

### 1. Lingkungan Pengembangan Lokal (Local Development)

```bash
# 1. Kloning repository & instal dependensi
npm install --legacy-peer-deps

# 2. Siapkan konfigurasi environment
cp .env.example .env
# Sesuaikan DATABASE_URL dan kredensial sesi pada .env

# 3. Jalankan suite pengujian unit (otentikasi, kurva-S, WBS, RBAC)
npm test

# 4. Jalankan server pengembangan terintegrasi (Express + Vite HMR di port 3000)
npm run dev
```

### 2. Deployment Produksi (Docker Compose)

```bash
# 1. Bangun dan jalankan container secara terisolasi
docker compose up -d --build

# 2. Sinkronkan skema database Drizzle ke PostgreSQL
docker compose exec app npm run db:push

# 3. Inisialisasi akun pengguna awal, proyek contoh, dan master checklist
docker compose exec app npm run db:seed

# 4. Verifikasi status kesehatan container
curl -k https://localhost/api/health
```

---

## 📜 Perintah Kerja (Scripts Reference)

| Perintah | Deskripsi |
|---|---|
| `npm run dev` | Menjalankan server dev Express + Vite PWA secara simultan |
| `npm run build` | Kompilasi bundle produksi frontend dan Service Worker ke `dist/` |
| `npm run lint` | Pemeriksaan tipe statis TypeScript (`tsc --noEmit`) |
| `npm test` | Menjalankan seluruh pengujian unit Node.js test runner (`tsx --test`) |
| `npm run db:generate` | Menghasilkan berkas migrasi SQL Drizzle ke direktori `drizzle/` |
| `npm run db:push` | Mendorong perubahan skema langsung ke database target |
| `npm run db:seed` | Mengisi database dengan peran, akun pengujian, proyek, dan template acuan |

---

## 🔒 Kebijakan Keamanan & Integritas Data

1. **No Self-Approval:** Sistem menolak persetujuan gerbang inspeksi jika pengguna yang menyetujui memiliki ID yang sama dengan pemohon inspeksi (`server.ts:474`).
2. **No Self-Closing:** Pelaksana perbaikan dilarang menutup status temuan tanpa verifikasi dari QA/QC independen.
3. **Forensic Evidence Integrity:** Setiap lampiran foto bukti diverifikasi dengan hashing SHA-256 untuk memastikan keabsahan audit.
4. **Audit Trail Mutasi:** Perubahan kritis pada struktur WBS, status inspeksi, dan penimpaan jadwal terekam pada tabel `audit_logs`.

---

## 🙏 Credits & Referensi

Sebagian fitur pada SiteLens terinspirasi dan diadaptasi dari proyek sumber terbuka berikut:

* **Project Desk** (v1.3.3) oleh **WIDIRU STUDIO** (Widi Raspito Utomo) — *Personal PMO Suite (PMBOK Guide 6th Edition)*.  
  Inspirasi fitur: Critical Path Method (CPM) & deteksi siklus dependensi, penanda `"TODAY"` & metrik EVM (`SV`, `SPI`) pada Kurva-S, *baseline snapshots*, SLA *selective pause*, proteksi *CSV Formula Injection* (RFC-4180), dan alur kontrol perubahan (*Variation Order*).  
  Repositori: [widiru83/project-desk-](https://github.com/widiru83/project-desk-) · Demo: [project-desk-demo](https://widiru83.github.io/project-desk-demo/)
* **API Hari Libur Indonesia** oleh **radyakaze** — *Scraper hari libur nasional berbasis tanggalans.com*.  
  Inspirasi fitur: Pola ekstraksi jadwal hari libur nasional Indonesia dari `tanggalans.com` untuk kalender kerja proyek.  
  Repositori: [radyakaze/api-hari-libur](https://github.com/radyakaze/api-hari-libur)
