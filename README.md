# SiteLens — Platform Inspeksi Lapangan, Master-Data Checklist, dan CAPA Self-Hosted

SiteLens adalah platform perangkat lunak **dedicated dan self-hosted (single-tenant)** yang dirancang untuk menyatukan inspeksi lapangan, master-data daftar periksa (checklist), kalkulasi rekayasa integritas peralatan bertekanan (API 510, API 570, ASME), serta siklus penanganan Tindakan Korektif dan Preventif (CAPA) *closed-loop* untuk sektor konstruksi, migas, dan industri proses.

Platform ini mengadopsi prinsip **keterlacakan independen dan four-eyes principle** (ISO 9001:2015 Klausul 10.2, ISO 45001:2018, API 510/570) serta kepatuhan ganda regulasi K3 nasional Indonesia (**SMK3 PP No. 50/2012** dan **Bahan Kimia Berbahaya Kepmenaker 187/1999**).

---

## 5 Peran Resmi Sistem (Enterprise RBAC)

Mengacu pada Bagian 1 Dokumen Spesifikasi Produk (PRD), SiteLens menegakkan 5 peran resmi beserta batas wewenang ketat di lapisan backend:

1. **`Field Inspector / Petugas K3`** (Mobile & Web)  
   Menjalankan sesi inspeksi, merekam bukti foto ber-geotag GPS dan hash SHA-256, mencatat pembacaan ketebalan UT, dan memicu *Stop Work Authority* (SWA) untuk temuan kritikal. *Tidak dapat menutup CAPA sendiri atau mengubah rumus rekayasa.*
2. **`Action Owner / Pelaksana Perbaikan`** (Mobile & Web)  
   Menerima tindakan koreksi segera (*containment/ICA*) dan rencana korektif permanen (*PCA*), memperbarui progres kerja, dan mengunggah foto pasca-perbaikan. *Dilarang keras memverifikasi atau menutup tindakannya sendiri.*
3. **`Office / Integrity Engineer`** (Web)  
   Mengelola sirkuit perpipaan, bejana tekan, dan CML; memvalidasi laju korosi (*governing rate*); mengevaluasi batas ketebalan minimum ($t_{min}$), Fitness-For-Service (FFS API 579-1), rerating, dan peninjauan deferral.
4. **`Authorized Inspector (API 510/570) & Verifikator K3`** (Web & Mobile)  
   Mengesahkan laporan inspeksi integritas bertekanan, melakukan verifikasi fisik implementasi perbaikan (*four-eyes check*), dan mengevaluasi efektivitas pasca-jendela pemantauan 30–90 hari.
5. **`HSE / Quality Manager & Tenant Admin`** (Web)  
   Mengonfigurasi profil tenant (target tingkat SMK3 & status Major Hazard), mengelola master template ISO/ASME/API, provisioning user, dan memantau KPI keselamatan (FR, SR, tren CAPA).

---

## Kemampuan Utama Sesuai PRD

- **Dual-Compliance Mechanism:** Otomatis memetakan temuan inspeksi ke 12 Elemen Audit SMK3 (PP No. 50/2012) dan Klausul ISO 45001:2018, dilengkapi deteksi Instalasi Potensi Bahaya Besar (Major Hazard) berbasis Nilai Ambang Kuantitas (NAK Kepmenaker 187/1999).
- **Master-Data Aset Fisik & Registri Legalitas:**
  - **Piping Circuit & CML (API 570 / API RP 574):** Seed dimensi ASME B36.10M (NPS 1/8 s.d. NPS 36), batas toleransi pabrik -12.5%, dan alert thickness.
  - **Bejana Tekan (API 510 / ASME BPVC Section VIII Div. 1):** Komponen shell, head elipsoidal 2:1, nozzle, dan efisiensi sambungan las (UW-12).
  - **Registri PAA & Lisensi Personel:** Pelacakan masa berlaku Suket K3/SIA Kemnaker (Permenaker 8/2020), SILO Migas, dan SIO Operator dengan penguncian operasional otomatis (`PROHIBITED_DO_NOT_OPERATE`) jika kedaluwarsa.
  - **Soft Archive & Restore:** Mencegah perusakan riwayat audit dan pemeliharaan historis.
- **Engine Rekayasa Integritas Deterministik:**
  - Laju korosi jangka panjang ($CR_{LT}$), jangka pendek ($CR_{ST}$), laju penentu $CR_{gov} = \max(CR_{LT}, CR_{ST})$, dan Coefficient of Variation ($COV > 10\%$).
  - Perhitungan $t_{min}$ (ASME B31.3 & UG-27) dan Remaining Life ($RL$).
  - Proyeksi MAWP berlanjut dengan aturan korosi ganda ($2 \cdot CR \cdot I$) dan pembesaran jari-jari dalam terkorosi ($R_{corr}$).
  - Validator 3-syarat *Widely Scattered Pitting* (API 510 Par. 7.4.3).
- **Tata Kelola Bukti Anti-Tampering:**
  - Komputasi hash SHA-256 (`file_hash_sha256`) langsung di browser/PWA via Web Crypto API.
  - Perekaman koordinat GPS (latitude, longitude) dan stempel waktu ISO 8601 UTC (`captured_at`).
  - Verifikasi ulang nilai hash oleh server saat pengunggahan untuk mencegah pemalsuan foto bukti.
- **State Machine CAPA Closed-Loop:**
  - Transisi status: `OPEN` $\rightarrow$ `IN_PROGRESS` $\rightarrow$ `PENDING_VERIFICATION` $\rightarrow$ `EFFECTIVENESS_MONITORING` (30–90 hari) $\rightarrow$ `CLOSED`.
  - Penegakan **Four-Eyes Principle**: Pemisahan tegas penanggung jawab perbaikan dan verifikator independen.
  - SLA otomatis berbasis Matriks Risiko $5 \times 5$: Critical (1x24 jam), High (3x24 jam), Medium (7 hari), Low (14 hari).
  - Kalkulator metrik keselamatan kerja: Frequency Rate (FR) dan Severity Rate (SR) per 1.000.000 jam kerja.

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
