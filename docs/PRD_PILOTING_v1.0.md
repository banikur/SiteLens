# PRD Fixed Piloting (v1.0-Pilot): Project Control dan Progress Monitoring Berbasis Inspeksi (SiteLens)

> **Status:** Locked & Approved (SSOT)  
> **Target:** Piloting Project Control & Field Inspection Platform  
> **Dokumen Acuan:** Rekonsiliasi PRD v0.1, README.md SiteLens, dan Keputusan Konsensus *Grill-Me* (November 2026).

---

## 1. Orientasi Produk & Rekonsiliasi Cakupan

Laporan progres proyek melalui kurva S kerap tertahan bukan karena pekerjaan fisik di lapangan berhenti, melainkan karena laporan inspeksi dan persetujuan teknis masih menggunakan formulir kertas, dikumpulkan secara manual, serta bergantung pada tanda tangan basah (*Waste of Waiting*).

SiteLens adalah platform **Project Control dan Progress Monitoring Berbasis Inspeksi** yang bersifat agnostik jenis pekerjaan dengan struktur pohon WBS (*Work Breakdown Structure*) dinamis, template alur kerja fleksibel, dan penguncian gerbang mutu independen.

### 1.1 Posisi Kompetitif & Diferensiasi Pasar (SiteLens vs Proyektra.id)

Di industri konstruksi Indonesia, perangkat lunak seperti **Proyektra.id** memposisikan diri sebagai sistem ERP modular all-in-one yang berfokus pada sisi komersial (RAB/AHSP, RAP, pengadaan material, alat berat, dan kas subkontraktor). SiteLens **sengaja tidak bersaing di zona ERP/akuntansi generalis**, melainkan memposisikan diri sebagai **"The Field Integrity & Quality Gatekeeper"** (setara *Procore Quality & Safety* atau *Autodesk Construction Cloud* versi Indonesia) yang berfokus mutlak pada **integritas fisik lapangan dan pencegahan manipulasi progres**.

| Dimensi Penilaian | ERP Konstruksi Generalis (misal: Proyektra.id) | SiteLens (Project Control & Inspection Engine) | Keunggulan Kompetitif SiteLens (*Right to Win*) |
| :--- | :--- | :--- | :--- |
| **Model Progres Fisik** | Opname kuantitas volume harian yang diisi mandor | **Dual-Track Biner**: *Claimed Progress* vs *Verified Physical Progress* | Menghilangkan manipulasi klaim sepihak. Progres resmi tertahan sampai gerbang mutu lolos. |
| **Kunci Gerbang Mutu** | Checklist inspeksi standar tanpa interlock | **Programmatic Hold Point Lockout** | Pekerjaan lanjutan dikunci secara sistem jika tahapan kritis (misal: pembesian/uji beton) belum disetujui. |
| **Integritas Punchlist** | Pencatatan temuan cacat lapangan umum | **Zero-Tolerance Punchlist Gate** | Jika masih ada punchlist cacat terbuka (Critical s/d Low), progres fisik WBS **dilarang 100%**. |
| **Tata Kelola Otorisasi** | Akses peran standar (Admin, Staf, Mandor) | **Four-Eyes Principle Enforced at Database Level** | Pelaksana dilarang keras menyetujui pekerjaannya sendiri atau menutup cacatnya sendiri. |
| **Integritas Bukti Foto** | Penyimpanan foto standar | **SHA-256 Geotagged Forensic Hashing** | Setiap foto dan pindaian dokumen diberi hash anti-tamper untuk keperluan audit BPK/LKPP/Owner. |
| **Efisiensi Birokrasi** | Chat proyek dan notifikasi umum | **Bottleneck Radar & SLA Aging Tracker** | Mendeteksi keterlambatan akibat lambatnya persetujuan inspeksi konsultan/owner (<24h, 24-48h, >48h). |

### Matriks Rekonsiliasi Keputusan Piloting

| Dimensi Spesifikasi | Posisi PRD v0.1 | Posisi README SiteLens | Keputusan Fixed Piloting (v1.0-Pilot) |
| :--- | :--- | :--- | :--- |
| **Identitas & Domain** | Sistem web agnostik jenis pekerjaan berbasis pohon WBS | Platform self-hosted single-tenant SiteLens untuk EPC & konstruksi sipil | Arsitektur inti agnostik lintas proyek dengan preset `General EPC Pack`, `Civil Building Pack`, dan `Blank Canvas`. |
| **Model Peran** | Role dinamis buatan admin | 5 peran praktis tetap & four-eyes principle | **Hybrid Project Membership**: 6 peran standar (`users.role` sebagai default sistem, `project_members` mengunci peran spesifik per proyek dengan batasan `assignedProjects`). |
| **Jalur Pengakuan Progres** | Progres biner ($0\%$ atau $100\%$) | Dual-Track (Target, Claimed, Verified Physical Progress) | **Dual-Track Biner**: Tahap kerja selesai mengisi *Claimed Progress*, sedangkan *Verified Physical Progress* baru sah setelah gerbang inspeksi lolos dan bebas cacat terbuka. |
| **Penanganan Bobot** | Bobot per level ditampilkan, peringatan jika $\neq 100\%$ tanpa blokir | Alokasi bobot milestone berimbang $100\%$ | Simpan draf diperbolehkan dengan peringatan non-blokir bila total bobot $\neq 100\%$. Perhitungan memakai penjumlahan berbobot langsung tanpa normalisasi tersembunyi. |
| **Pertukaran Data** | Impor struktur Excel, ekspor Excel/PDF | Ekspor laporan mingguan resmi PDF via `jspdf` | Keduanya didukung: ekspor PDF mingguan resmi ditambah impor/ekspor data Excel. |
| **Tanda Tangan** | Cetak lembar, tanda tangan basah, unggah scan | Persetujuan digital four-eyes check | **Dual Support**: Tanda tangan digital via touch canvas/stempel langsung di PWA, plus tombol cetak lembar fisik dan unggah hasil scan yang selalu tersedia (non-blocking). |
| **Punchlist Lockout Gate** | Penahan gerbang | Critical & High membekukan milestone | **Zero Tolerance Lockout**: Semua temuan cacat terbuka (Critical, High, Medium, Low) wajib berstatus `verified_closed` oleh pihak independen sebelum progres fisik diakui $100\%$. |
| **Siklus Periode Kurva S** | Fleksibel | Mingguan | **Kalender Baku (Senin–Minggu)**: Periode mingguan dipatok dari Senin 00:00 s/d Minggu 23:59. |

---

## 2. Batasan Ruang Lingkup & Tech Stack

### In-Scope (Fase Piloting & Fast-Follow Extensions)
1. **WBS Tree Engine:** Pohon WBS dengan kedalaman tak terbatas, nomor dan revisi dokumen acuan opsional (misal: "DWG-STR-001 Rev C").
2. **Preset Templates:** `General EPC Pack`, `Civil Building Pack`, dan `Blank Canvas`.
3. **Dual-Track Progress:** Kurva S mingguan (*Target Timeline*, *Claimed Progress*, *Verified Physical Progress*).
4. **Bottleneck Radar & SLA Aging:** Pelacak waktu tunggu persetujuan inspeksi (<24h normal, 24–48h warning, >48h critical bottleneck).
5. **Zero Tolerance Punchlist Lockout:** Penguncian progres terverifikasi saat terdapat temuan cacat terbuka.
6. **Offline-First PWA:** Pengisian checklist & foto di IndexedDB (`idb`) saat blind spot, hashing SHA-256 foto bukti, auto-sync saat online + tombol manual sync.
7. **Ekspor & Impor:** Ekspor laporan mingguan resmi PDF (`jspdf`), impor/ekspor struktur WBS Excel.
8. **Weather & Rain Log (Buku Harian Cuaca & EOT):** Pencatatan hari dan jam hujan harian yang berkorelasi langsung dengan justifikasi deviasi Kurva S serta klaim perpanjangan waktu (*Claim of Time / Extension of Time*).
9. **Official BAPP Generator (Berita Acara Progres Pekerjaan):** Generator otomatis lembar BAPP termin resmi berlandaskan milestone inspeksi yang sudah lolos uji verifikasi bebas cacat.
10. **2D Drawing Defect Pinning (Plotting Cacat pada Gambar Kerja):** Penandaan visual posisi cacat/punchlist langsung di atas gambar kerja WBS (`documentReferenceNo` & `activeRevision`).

### Out-of-Scope (Ditunda ke Pasca-Pilot)
* Integrasi dua arah langsung dengan Primavera P6 atau Microsoft Project.
* Perhitungan *Earned Value Management* (EVM) berbasis biaya rupiah/dolar (fokus pada progres fisik).
* Skema *multi-tenant billing* dan pembayaran langganan.
* Progres persentase parsial per tahap (seluruh tahap dievaluasi biner: $0\%$ atau $100\%$).

### Stack Teknologi Terpilih
* **Frontend:** React 19, Vite, Tailwind CSS v4, Motion, Lucide Icons, `jspdf`, `idb`, `vite-plugin-pwa`.
* **Backend:** Express 4, Node.js 22, Drizzle ORM, PostgreSQL 16, `@simplewebauthn` (Passkey/Biometric).
* **Keamanan:** Terverifikasi Grade A+ (100/100) via `vibe-shield` static security analyzer.
* **Infrastruktur:** Docker Compose (`app`, `postgres`, `caddy` reverse-proxy auto-HTTPS).

---

## 3. Matriks Peran Proyek (Core RBAC & Four-Eyes)

| Peran Piloting | WBS, Bobot & Jadwal | Eksekusi Kerja & RFI | Checklist Lapangan | Tindak Lanjut CAPA | Approval Gate & Tutup CAPA | Kelola Tim & Ekspor |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Project Director & Tenant Admin** | Tinjau penuh; override kurva rencana | Baca status penuh | Baca penuh | Baca penuh | Tinjau & ekspor laporan | Kelola user, role, audit log, ekspor PDF/Excel |
| **Project / Site Engineer** | Buat/ubah node WBS, bobot, tanggal rencana | Tandai tahap selesai, ajukan RFI | Baca & tindak lanjuti | Disposisi penugasan | Dilarang approve inspeksi yang diajukan sendiri | Impor/ekspor WBS Excel |
| **Field / QC Inspector** | Baca struktur & jadwal | Baca status kesiapan | Jalankan checklist (offline/online), upload foto, buat punchlist | Baca progres perbaikan | Dilarang tutup temuan sendiri tanpa verifikasi independen | Ekspor checklist individual |
| **Action Owner / Subcontractor** | Baca jadwal area kerja | Baca jadwal | Baca temuan yang ditugaskan | Update perbaikan & upload foto | **Dilarang keras verifikasi/tutup pekerjaan sendiri** | Tidak ada akses manajemen |
| **QA/QC Lead / Owner Inspector** | Tinjau kurva S & WBS | Baca RFI & antrean Radar | Baca detail checklist & foto | Tinjau bukti perbaikan | **Approve/reject gerbang inspeksi (four-eyes), validasi tutup punchlist** | Ekspor laporan inspeksi & PDF mingguan |
| **Client / Vendor Viewer** | Baca kurva S & status | Baca status ringkas | Baca inspeksi selesai | Baca punchlist terbuka | Tidak ada izin tulis (**read-only ketat**) | Unduh laporan yang dibagikan |

### 3 Larangan Keras Server-Side:
1. **No Self-Approval:** Pengguna yang mengajukan inspeksi dilarang menyetujui inspeksinya sendiri.
2. **No Self-Closing:** Pihak yang mengerjakan perbaikan punchlist dilarang memverifikasi/menutup pekerjaannya sendiri.
3. **Isolasi Proyek Ketat:** Pengguna yang tidak terdaftar di `assignedProjects` dan `project_members` ditolak dari membaca atau menulis entitas proyek terkait.

---

## 4. Model Data Relasional (Drizzle ORM)

```
[projects]
   ├── [project_members] ──> [users]
   ├── [planned_curve_overrides]
   ├── [audit_logs]
   └── [work_nodes] (Hierarchical WBS via parent_id)
          └── [work_workflows]
                 └── [work_stages] (work, hold, review)
                        ├── [inspection_attempts] (append-only)
                        │      └── [evidence_attachments] (SHA-256)
                        └── [punchlist_items] (Zero Tolerance Lockout)
```

---

## 5. State Machine & Bottleneck Radar

### Formula Kurva S
Untuk setiap minggu kalender $t$ (Senin–Minggu):
$$\text{Target}(t) = \sum \text{Bobot Node Selesai Sesuai Jadwal Rencana}$$
$$\text{Claimed}(t) = \sum \text{Bobot Node Selesai Sesuai Klaim Lapangan}$$
$$\text{Verified}(t) = \sum \text{Bobot Node yang Gerbangnya Approved \& Bebas Punchlist Open}$$

### Ambang Waktu Tunggu Bottleneck Radar
$$\Delta t = t_{\text{sekarang}} - t_{\text{pengajuan}}$$
* **Normal ($\Delta t < 24\text{ jam}$):** Hijau (antrean tinjau rutin).
* **Warning ($24 \le \Delta t \le 48\text{ jam}$):** Kuning (prioritas tindak lanjut reviewer).
* **Critical Bottleneck ($\Delta t > 48\text{ jam}$):** Merah (naik ke puncak radar, hitung pergeseran jadwal ke depan).

---

## 6. Rencana Eksekusi Bertahap (6 Fase)

* **Fase 1 (Selesai):** Fondasi Skema Drizzle WBS & Core RBAC (`project_members`, `work_nodes`, seeding 6 peran, preset EPC & Civil).
* **Fase 2 (Selesai):** Project Setup Studio UI (Pohon WBS, alokasi bobot manual, nomor/revisi dokumen acuan, Preset Chooser).
* **Fase 3 (Selesai):** State Machine Gerbang, Multi-Stage Workflow (Hold Point, Witness, Review), Dual-Track Signatures (Canvas Touchscreen & Cetak/Upload Lembar Fisik), dan Zero-Tolerance Punchlist Lockout.
* **Fase 4 (Berikutnya):** Mesin Kalkulasi Kurva S Kalender Baku (Senin–Minggu), Bottleneck Radar SLA Tracker, Manual Override PM, serta **Weather & Rain Log (Buku Harian Cuaca & Curah Hujan untuk EOT)**.
* **Fase 5:** Offline-First PWA (IndexedDB + SHA-256 + Auto Sync), Impor Excel WBS, Ekspor Laporan Mingguan Resmi PDF, **Official BAPP Generator (Berita Acara Pembayaran Termin Otomatis)**, dan **2D Drawing Defect Pinning (Plotting Temuan pada Gambar Kerja)**.
* **Fase 6:** Audit Keamanan Menyeluruh (`vibe-shield`), Uji End-to-End, dan Packaging Docker Compose Produksi.
