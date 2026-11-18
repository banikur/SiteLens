# SiteLens — Platform Monitoring Bottleneck Laporan Inspeksi & Verifikasi Progress Proyek

SiteLens adalah platform perangkat lunak **dedicated dan self-hosted (single-tenant)** yang dirancang untuk mengatasi **bottleneck laporan inspeksi / Request for Inspection (RFI)** dan menjamin **validitas progress fisik pekerjaan (*verifiable progress*)** untuk sektor EPC, konstruksi sipil, mekanikal, instalasi, dan pengadaan.

Platform ini menghubungkan eksekusi inspeksi lapangan langsung ke milestone proyek dengan prinsip **keterlacakan independen dan four-eyes principle**: progres pekerjaan tidak dapat diakui sepihak sebelum diverifikasi secara fisik melalui checklist inspeksi dan bebas dari temuan cacat kritis/mayor (*punchlist gate*).

---

## 5 Peran Praktis Proyek (Enterprise RBAC)

SiteLens membagi wewenang operasional proyek ke dalam 5 peran praktis dengan penegakan izin ketat di lapisan backend:

1. **`Field / QC Inspector`** (Mobile PWA & Web)  
   Menjalankan sesi inspeksi lapangan secara *offline-first*, merekam bukti foto bertanda waktu, menandai poin pemeriksaan (Pass/Fail), dan menerbitkan temuan cacat (*punchlist*). *Tidak dapat menutup temuannya sendiri tanpa verifikasi pihak independen.*
2. **`Action Owner / Subcontractor`** (Mobile & Web)  
   Menerima disposisi perbaikan punchlist/CAPA, memperbarui progres perbaikan di lapangan, dan mengunggah foto bukti pasca-perbaikan. *Dilarang keras memverifikasi atau menutup pekerjaannya sendiri.*
3. **`Project / Site Engineer`** (Web)  
   Mengelola milestone WBS di Project Setup Studio, mengatur bobot progres (%), menyusun target timeline jadwal, dan mengajukan permintaan inspeksi (RFI).
4. **`QA/QC Lead / Owner Inspector`** (Web & Mobile)  
   Menandatangani persetujuan laporan inspeksi (*four-eyes check*), memvalidasi penutupan punchlist kritis, dan mengesahkan klaim progress fisik pekerjaan.
5. **`Project Director & Tenant Admin`** (Web)  
   Memantau dasbor Kurva-S (*Target Timeline vs Verified Physical Progress*), memonitor *Bottleneck Radar* (laporan inspeksi yang tersendat), mengelola akses tim, dan mengekspor laporan mingguan resmi.

---

## Kemampuan Inti Platform

- **Project Setup Studio & Milestone WBS Engine:**
  - Pilihan cepat: **General EPC / Civil Pack** (milestone standar) atau **Blank Canvas** (kustom dari nol).
  - Alokasi bobot milestone berimbang (total 100%) dan target jadwal (Start/End Date).
  - Pengikatan checklist inspeksi wajib (*Inspection Gate*) pada setiap milestone.
- **Bottleneck Radar & Aging SLA Tracker:**
  - Melacak laporan inspeksi yang tertahan di meja reviewer dengan indikator waktu: Normal (<24h), Warning (24–48h), dan Critical Bottleneck (>48h).
  - Mengidentifikasi secara transparan personil/peran yang menahan persetujuan laporan.
  - Mengukur dampak keterlambatan laporan inspeksi terhadap deviasi jadwal proyek (*Schedule Variance*).
- **Dual-Track Progress vs Timeline (Kurva-S):**
  - Membandingkan kurva **Target Timeline**, **Claimed Progress**, dan **Verified Physical Progress** (progress riil yang sah lolos inspeksi).
- **Severity-Gated Punchlist Lockout:**
  - Cacat status *Critical* & *High* otomatis membekukan milestone dari klaim komplit hingga perbaikan diverifikasi (*Four-Eyes Principle*).
  - Cacat *Low/Medium* tetap terlacak sebagai punchlist BAST tanpa mengunci progres fisik secara kaku.
- **Ekspor Laporan Mingguan Resmi (PDF):**
  - Menghasilkan ringkasan siap cetak: Kurva-S deviasi, status milestone, daftar bottleneck laporan tertunda, dan tabel punchlist untuk rapat koordinasi mingguan dengan Owner/Konsultan.
- **Offline-First PWA & Bukti Foto Lapangan:**
  - Inspektur dapat bekerja di area *blind spot* (basement, terowongan, site terpencil) dengan sinkronisasi antrean otomatis saat kembali online.
  - Komputasi hash SHA-256 dan stempel waktu UTC untuk integritas audit foto bukti.

---

## Tech Stack

- **Frontend:** React 19, Vite 8, Tailwind CSS v4, Motion, Lucide Icons, `jspdf`, `tesseract.js`, `idb`, `vite-plugin-pwa`
- **Backend:** Express, Node.js 22 (`tsx`), Drizzle ORM, PostgreSQL 16, `@simplewebauthn` (Passkey/Biometric), `nodemailer`, `@google/genai` (opsional BYOK)
- **Infrastruktur:** Docker Compose (`app`, `postgres`, `caddy` reverse-proxy auto-HTTPS)

---

## Panduan Cepat (Quick Start)

### 1. Pengembangan Lokal (Development)

```bash
# Instal dependensi
npm install --legacy-peer-deps

# Siapkan berkas environment
cp .env.example .env

# Jalankan pengujian unit rekayasa & otentikasi
npm test

# Jalankan server pengembangan (port 3000)
npm run dev
```

### 2. Deployment Single-Tenant (Docker Compose)

```bash
# Bangun dan jalankan seluruh container (postgres, app, caddy)
docker compose up -d --build

# Terapkan skema database Drizzle & seed data awal
docker compose exec app npm run db:push
docker compose exec app npm run db:seed

# Periksa status kesehatan sistem
curl -k https://localhost/api/health
```

---

## Perintah Kerja (Scripts)

| Perintah | Deskripsi |
|---|---|
| `npm run dev` | Menjalankan server dev Express + Vite PWA |
| `npm run build` | Kompilasi bundle produksi & Service Worker PWA ke `dist/` |
| `npm run lint` | Pemeriksaan tipe statis TypeScript (`tsc --noEmit`) |
| `npm test` | Menjalankan suite pengujian unit deterministik (`tsx --test`) |
| `npm run db:generate` | Menghasilkan berkas migrasi SQL Drizzle ke `drizzle/` |
| `npm run db:push` | Mendorong perubahan skema secara langsung ke database PostgreSQL |
| `npm run db:seed` | Mengisi data pengguna default, proyek, dan master template |
