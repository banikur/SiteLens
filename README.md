# SiteLens — Platform Monitoring Bottleneck Laporan Inspeksi & Verifikasi Progress Proyek

[![Vibe-Shield Security](https://img.shields.io/badge/Vibe--Shield-Grade_A%2B-10b981)](https://github.com/avivgerz-hue/vibe-shield)

SiteLens adalah platform perangkat lunak **dedicated dan self-hosted (single-tenant)** yang dirancang untuk mengatasi **bottleneck laporan inspeksi / Request for Inspection (RFI)** dan menjamin **validitas progress fisik pekerjaan (*verifiable progress*)** untuk sektor EPC, konstruksi sipil, mekanikal, instalasi, dan pengadaan.

Platform ini menghubungkan eksekusi inspeksi lapangan langsung ke milestone pohon WBS dengan prinsip **keterlacakan independen dan four-eyes principle**: progres pekerjaan tidak dapat diakui sepihak sebelum diverifikasi secara fisik melalui checklist inspeksi dan bebas dari temuan cacat terbuka (*Zero Tolerance Punchlist Lockout*).

> 📖 **Dokumentasi Spesifikasi Lengkap:** [docs/PRD_PILOTING_v1.0.md](file:///c:/Users/Programer/Documents/SiteLens/docs/PRD_PILOTING_v1.0.md)

---

## 6 Peran Proyek (Core RBAC & Hybrid Project Membership)

SiteLens menerapkan model **Core RBAC Hybrid**, di mana setiap pengguna memiliki peran bawaan sistem dan peran operasional spesifik per-proyek melalui tabel `project_members`, dengan pembatasan ketat hanya pada proyek yang ditugaskan (`assignedProjects`):

1. **`Field / QC Inspector`** (Mobile PWA & Web)  
   Menjalankan sesi inspeksi lapangan secara *offline-first*, merekam bukti foto bertanda waktu SHA-256, menandai poin pemeriksaan (Pass/Fail), dan menerbitkan temuan cacat (*punchlist*). *Tidak dapat menutup temuannya sendiri tanpa verifikasi pihak independen.*
2. **`Action Owner / Subcontractor`** (Mobile & Web)  
   Menerima disposisi perbaikan punchlist/CAPA, memperbarui progres perbaikan di lapangan, dan mengunggah foto bukti pasca-perbaikan. *Dilarang keras memverifikasi atau menutup pekerjaannya sendiri.*
3. **`Project / Site Engineer`** (Web)  
   Mengelola pohon WBS di Project Setup Studio, mengatur bobot progres manual (%), menyusun target timeline jadwal, dan mengajukan permintaan inspeksi (RFI).
4. **`QA/QC Lead / Owner Inspector`** (Web & Mobile)  
   Menandatangani persetujuan laporan inspeksi (*four-eyes check*), memvalidasi penutupan punchlist, dan mengesahkan klaim progress fisik pekerjaan.
5. **`Project Director & Tenant Admin`** (Web)  
   Memantau dasbor Kurva-S (*Target Timeline vs Verified Physical Progress*), memonitor *Bottleneck Radar* (laporan inspeksi yang tersendat), mengelola akses tim, mengesahkan penimpaan kurva rencana (*override*), dan mengekspor laporan mingguan resmi.
6. **`Client / Vendor Viewer`** (Web & Mobile)  
   Memantau kurva S, status penyelesaian pekerjaan, dan laporan inspeksi secara transparan dengan hak akses baca ketat (*read-only* tanpa izin mutasi).

---

## Kemampuan Inti Platform

- **Project Setup Studio & Modular WBS Presets:**
  - Pilihan preset awal: **General EPC Pack** (Eng, Proc, Const, Comm), **Civil Building Pack** (Pondasi, Struktur, MEP, Finis), atau **Blank Canvas** (kustom dari nol).
  - Alokasi bobot manual berimbang per level WBS dengan peringatan non-blokir bila total $\neq 100\%$.
  - Penyematan nomor dokumen dan revisi aktif gambar kerja acuan (misal: "DWG-STR-001 Rev C").
- **Bottleneck Radar & Aging SLA Tracker:**
  - Melacak laporan inspeksi yang tertahan di meja reviewer dengan indikator waktu: Normal (<24h), Warning (24–48h), dan Critical Bottleneck (>48h).
  - Mengidentifikasi secara transparan personil/peran yang menahan persetujuan laporan.
  - Mengukur dampak keterlambatan laporan inspeksi terhadap deviasi jadwal proyek (*Schedule Variance*).
- **Dual-Track Progress vs Timeline (Kurva-S Kalender Baku):**
  - Memotong siklus mingguan berdasarkan **Kalender Baku (Senin–Minggu)**.
  - Membandingkan kurva **Target Timeline**, **Claimed Progress**, dan **Verified Physical Progress** (progress riil yang sah lolos inspeksi).
  - Mendukung penimpaan manual kurva rencana mingguan (*planned curve overrides*) oleh Project Director / PM.
- **Zero Tolerance Punchlist Lockout:**
  - Seluruh temuan cacat terbuka (**Critical, High, Medium, Low**) wajib diverifikasi tutup (*verified_closed*) oleh pihak independen sebelum *Verified Physical Progress* diakui 100% pada tahap bersangkutan (*Four-Eyes Principle*).
- **Dual-Mode Signature & Tanda Tangan Basah:**
  - Tanda tangan digital langsung via layar sentuh (canvas/stempel) di PWA.
  - Tombol cetak form fisik dan unggah scan lembar bertanda tangan basah selalu tersedia sebagai opsi pendukung bagi kontrak yang mensyaratkannya.
- **Ekspor Laporan Mingguan Resmi (PDF & Excel):**
  - Menghasilkan ringkasan siap cetak: Kurva-S deviasi, status WBS, daftar bottleneck laporan tertunda, dan tabel punchlist untuk rapat koordinasi mingguan dengan Owner/Konsultan.
  - Mendukung ekspor data kurva dan impor/ekspor struktur WBS berbasis Excel.
- **Offline-First PWA & Bukti Foto Lapangan:**
  - Inspektur dapat bekerja di area *blind spot* (basement, terowongan, site terpencil) dengan penyimpanan draf di IndexedDB (`idb`).
  - Komputasi hash SHA-256 dan stempel waktu UTC untuk integritas audit foto bukti.
  - Sinkronisasi otomatis saat kembali online (*online event*) disertai banner progres, plus tombol manual "Sinkronkan Sekarang".

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
