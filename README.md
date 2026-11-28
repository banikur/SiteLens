# SiteLens — Platform Pemantauan & Pengendalian Progres Proyek

**SiteLens** membantu pemilik proyek, manajer proyek, tim lapangan, dan tim QA/QC memastikan **progres pekerjaan yang dilaporkan di Kurva-S benar-benar sesuai dengan kondisi nyata di lapangan** — bukan sekadar klaim di atas kertas.

Cocok untuk proyek **Konstruksi & EPC**, **Instalasi MEP**, **Manufaktur**, maupun **Pengadaan IT & Sistem Terpadu** (Software, Hardware, Lab, dan Uji Terima).

---

## 🎯 Masalah yang Diselesaikan

Dalam banyak proyek, laporan mingguan sering terlihat "hijau" padahal di lapangan:
* Pekerjaan diklaim selesai, namun **belum diperiksa** oleh tim QA/QC atau pemilik proyek.
* Barang/pekerjaan masih memiliki **catatan perbaikan (*punchlist* / temuan)** yang belum ditutup.
* Persetujuan pemeriksaan (*Request for Inspection / RFI*) **menumpuk dan tertahan** berhari-hari tanpa ketahuan siapa yang menahan.

**SiteLens menyelesaikan ini dengan satu aturan sederhana:**  
> *Progres resmi pada Kurva-S hanya diakui setelah pekerjaan lolos pemeriksaan independen (*Four-Eyes Principle*) dan bebas dari temuan cacat kritis yang masih terbuka.*

---

## 💡 Contoh Penggunaan (*Use Cases*)

### 1. Proyek Konstruksi Sipil & EPC
* Menyusun rincian paket pekerjaan berbobot 100% menggunakan template **Civil Building** atau **General EPC**.
* Mengunci tahapan kritis (*Hold Point*) seperti pengecoran atau instalasi struktur agar tidak bisa lanjut sebelum disetujui QA/QC.
* Mencatat log hujan harian untuk justifikasi perpanjangan waktu (*Extension of Time / EOT*).

### 2. Proyek Pengadaan IT, Smart Classroom & Hardware (SPEKTEK)
* Menggunakan template **IT & Pengadaan Terpadu (SPEKTEK Pack)** dengan satuan nyata seperti `Paket`, `Unit`, `Set`, `Modul`, `Lisensi`, dan `Lot`.
* Memantau progres pengadaan Software (LMS, Sistem Informasi) maupun Hardware (Server, Jaringan, Interactive Panel, Perangkat Lab) hingga tahap uji terima (*FAT/UAT*).
* Mengelola pekerjaan tambah atau revisi spesifikasi melalui **Variation Order (VO)** tanpa menghentikan pekerjaan tim di lapangan.

### 3. Tim Lapangan di Area Minim Sinyal (*Blind Spot*)
* Inspektor tetap bisa mengisi daftar periksa (*checklist*), mengambil foto bukti, dan mencatat temuan secara **offline** melalui browser/PWA. Data otomatis tersinkronisasi saat perangkat kembali terhubung ke internet.

---

## ✨ Fitur Utama untuk Pengguna

* **Struktur Pekerjaan & Template Siap Pakai:** Susun daftar pekerjaan bertingkat beserta bobot, target tanggal, *Milestone* (0 hari), dependensi antar-pekerjaan (*Critical Path*), dan dokumen acuan.
* **Kurva-S & Pemantau Keterlambatan Otomatis:** Bandingkan target rencana vs progres klaim vs progres terverifikasi lengkap dengan garis **`TODAY`**, indikator percepatan/keterlambatan (**SV & SPI**), serta simpan **Baseline** rencana.
* **Gerbang Persetujuan Empat Mata (*Four-Eyes*):** Pengaju atau pelaksana pekerjaan tidak dapat menyetujui pekerjaannya sendiri — harus diverifikasi oleh pemeriksa independen dengan tanda tangan digital di layar maupun unggahan scan tanda tangan basah.
* **Radar Antrean Persetujuan (SLA):** Pantau pengajuan pemeriksaan yang tertahan (`<24 jam`, `24–48 jam`, `>48 jam`) berdasarkan **jam kerja proyek** (default Senin–Jumat `08:00–17:00`, aturan lembur Sabtu/Minggu, dan sinkronisasi **Hari Libur Nasional Indonesia**).
* **Pengendalian Temuan Cacat (CAPA):** Temuan kritis/tinggi yang masih terbuka otomatis menahan pengakuan progres item pekerjaan di angka maksimal **99%** sampai perbaikan selesai diverifikasi.
* **Variation Order (VO) Fleksibel:** Ajukan perubahan lingkup atau bobot pekerjaan. Pekerjaan mendesak di lapangan tetap bisa berjalan (*Provisional*) sambil menunggu persetujuan resmi PM/Manajemen.
* **Ekspor Laporan Resmi & Kop Surat Perusahaan:** Unggah logo perusahaan dan atur kop surat resmi untuk langsung mencetak formulir checklist kosong, laporan hasil inspeksi bersertifikat (PDF), dan rekap CSV.

---

## 👥 Siapa Memakai Apa?

| Peran | Aktivitas Utama di SiteLens |
| :--- | :--- |
| **Project Director / PM** | Memantau Kurva-S, menyimpan Baseline, menyetujui *Variation Order*, dan mengunduh laporan resmi. |
| **Site / Project Engineer** | Menyusun rincian pekerjaan, mengatur jadwal, mengajukan pemeriksaan (*RFI*), dan mengajukan *Variation Order*. |
| **QA/QC Lead / Owner Inspector** | Memeriksa hasil pekerjaan secara independen, memberi persetujuan gerbang mutu, dan memverifikasi penutupan temuan. |
| **Field / QC Inspector** | Menjalankan inspeksi lapangan (online maupun offline), mengunggah foto bukti, dan mencatat temuan ketidaksesuaian. |
| **Subcontractor / Pelaksana** | Menerima disposisi perbaikan temuan dan mengunggah bukti hasil perbaikan. |
| **Client / Owner Viewer** | Memantau Kurva-S, progres terverifikasi, dan riwayat laporan secara *read-only*. |

---

## 🖼️ Tangkapan Layar (*Screenshots*)

> *Tempatkan tangkapan layar aplikasi di folder `docs/screenshots/` dan tautkan di sini sebelum rilis ke pengguna:*
> - Dasbor Portofolio & Ringkasan Proyek (`dashboard.png`)
> - Kurva-S & Matriks Jadwal Mingguan (`scurve.png`)
> - Studio Rincian Pekerjaan & Gerbang Persetujuan (`wbs-studio.png`)
> - Radar SLA & Kalender Kerja / Variation Order (`radar-governance.png`)

---

## 🚀 Cara Menjalankan Aplikasi (Untuk Admin / Tim IT)

### Menjalankan via Docker (Direkomendasikan untuk Produksi)
```bash
cp .env.example .env
# Sesuaikan konfigurasi database dan password admin di file .env
docker compose up -d --build
docker compose exec app npm run db:push
docker compose exec app npm run db:seed
```

### Menjalankan di Komputer Lokal
```bash
npm install --legacy-peer-deps
cp .env.example .env
npm run db:push
npm run db:seed
npm run dev
```
Setelah berjalan, buka browser dan akses `http://localhost:3000`.

---

## 🙏 Credits & Referensi

Sebagian fitur pada SiteLens terinspirasi dan diadaptasi dari proyek sumber terbuka berikut:

* **Project Desk** (v1.3.3) oleh **WIDIRU STUDIO** (Widi Raspito Utomo) — *Personal PMO Suite (PMBOK Guide 6th Edition)*.  
  Inspirasi fitur: Critical Path Method (CPM) & deteksi siklus dependensi, penanda `"TODAY"` & metrik jadwal (`SV`, `SPI`) pada Kurva-S, *baseline snapshots*, SLA *selective pause*, proteksi ekspor CSV, dan alur kontrol perubahan (*Variation Order*).  
  Repositori: [widiru83/project-desk-](https://github.com/widiru83/project-desk-) · Demo: [project-desk-demo](https://widiru83.github.io/project-desk-demo/)
* **API Hari Libur Indonesia** oleh **radyakaze** — *Scraper hari libur nasional berbasis tanggalans.com*.  
  Inspirasi fitur: Pola ekstraksi jadwal hari libur nasional Indonesia untuk kalender kerja proyek.  
  Repositori: [radyakaze/api-hari-libur](https://github.com/radyakaze/api-hari-libur)
