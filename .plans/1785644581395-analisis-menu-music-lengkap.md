# Laporan Lengkap — Analisis Menu Music & Seluruh Web (homelab-media-server)

**Tanggal:** 2026-08-02  
**Proyek:** /home/CATIAA/homelab-media-server/  
**Metode:** Kombinasi manual (baca kode) + otomatis (eksplorasi file, grep, test harness).  
**Bahasa:** Bahasa Indonesia  
**Fokus:** Menu Music (frontend + backend) + dampak keseluruhan web.

---

## 1. Ringkasan Eksekutif

Menu Music (`playlists`, `audio`, `music`) adalah menu paling kompleks dalam aplikasi (kompleksitas #1 dari 10 menu).  
- **Frontend:** Komponen `Music.jsx` sangat besar (>1200 baris), mengintegrasikan sinkronisasi video/audio (MV/BG engine), memori drift, pipeline, scheduler, decoder, serta analisa sensor. Ini bukan sekadar pemutar musik, melainkan sistem kontrol sinkronisasi yang kompleks.
- **Backend:** `routes/playlists.js` (1.126 baris) menangani CRUD playlist, import XSPF, scan folder, pembuatan playlist manual, serta resolusi file dengan heuristik multi-jalur.
- **Bug yang ditemukan:** Potensi SQL injection melalui interpolasi langsung (`IN (${placeholders})`), masalah deduplikasi path yang bisa gagal, null pointer saat `MEDIA_ROOT` kosong, serta kerentanan dalam penanganan file import.

---

## 2. Alur Kerja Menu Music (End-to-End)

### 2.1 Alur Pengguna (Frontend)
1. Pengguna membuka sidebar → pilih **Music**.
2. Frontend memuat daftar playlist (`GET /api/playlists`).
3. Pengguna memilih playlist → `GET /api/playlists/:id` (detail + track list).
4. Pengguna menekan **Play** → `GET /api/playlists/:id/play` untuk antrian pemutaran.
5. Komponen `Music.jsx` memuat file audio/video, menginisialisasi `MusicPlayer`, dan menjalankan sinkronisasi antara audio dan video melalui `createVideoSyncEngine`.
6. Selama pemutaran, sistem melakukan tick setiap ~30ms untuk mengukur drift, mengoreksi soft/hard seek, serta mencatat telemetry.

### 2.2 Alur Data (Backend)
1. **Database (SQLite):** Tabel `playlists`, `playlist_tracks`, `files`, `folders`.
2. **Scan:** `POST /api/playlists/scan` → `utils/playlistScanner.js` → memasukkan data ke DB.
3. **CRUD Playlist:** `routes/playlists.js` menangani semua operasi. Setiap operasi menggunakan `stmts` (prepared statements) kecuali beberapa query dinamis yang menggunakan interpolasi string.
4. **Resolusi File:** Backend mencari file di DB berdasarkan `dir_path` dan `name`, serta mencoba beberapa heuristik (path lengkap, root prefix, nama file saja).

---

## 3. Kerumitan (Complexity Analysis)

### 3.1 Metrik Proyek (dari MENU_COMPLEXITY_ANALYSIS.md & ARCHITECTURE.md)

| Metrik | Nilai |
|---|---|
| Total file frontend | ~150 |
| Total file backend | ~105 |
| Total LOC | 60.549 |
| Menu teratas | 10 |
| Module rute backend | 19 |
| File backend terbesar | `downloader/manager.js` (2.030 baris), `routes/playlists.js` (1.126 baris) |
| Menu Music | **Kompleksitas tertinggi** (#1) |

### 3.2 Komponen Music (Frontend)

- **File:** `frontend/src/components/Music.jsx`
- **Baris:** 1.238+ (terpotong saat baca, sangat besar)
- **Kompleksitas:** Sangat tinggi. Menggabungkan:
  - State React (`useState`, `useRef`, `useMemo`)
  - Sinkronisasi video/audio (`createVideoSyncEngine`)
  - Memori (`DriftMemory`, `PipelineMemory`, `SchedulerMemory`, `DecoderMemory`, `LearningMemory`, `GlobalMemory`)
  - Analisa (`evaluateDriftAnalyzer`, `evaluatePipelineAnalyzer`, `evaluateSchedulerAnalyzer`, `evaluateDecoderAnalyzer`, `evaluateConsistencyAnalyzer`)
  - Telemetry (`buildSensorSnapshot`, `validateAndAttach`, `logSensorSnapshot`)
  - Keputusan (`decide`, `ExecutionQueue`, `getConstraints`, `createActionRequest`)
  - Sensor dan overlay (`SyncOverlay`)

### 3.3 Komponen Playlist (Backend)

- **File:** `backend/src/routes/playlists.js`
- **Baris:** 1.126
- **Fungsi utama:**
  - `GET /` — semua playlist
  - `GET /:id` — detail + track + resolusi file
  - `GET /:id/play` — antrian pemutaran + sorting (+ query params `sortBy`, `sortOrder`)
  - `POST /scan` — scan XSPF
  - `POST /:id/refresh` — refresh playlist
  - `DELETE /:id` — hapus (soft/permanent)
  - `POST /create/manual` — buat manual dari fileIds
  - `POST /create/empty` — buat kosong
  - `POST /:id/tracks` — tambah track
  - `DELETE /:id/tracks/:trackId` — hapus track
  - `POST /:id/tracks/delete` — bulk hapus
  - `GET /:id/available-tracks` — cari file audio untuk ditambahkan
  - `POST /create/folder` — buat dari folder
  - `POST /import` — import XSPF (multipart)

---

## 4. Bug & Masalah yang Ditemukan

### 4.1 Bug Kritis / Potensi Keamanan

#### B1 — Potensi SQL Injection (Interpolate String Langsung)
**Lokasi:** `routes/playlists.js` (baris 820, 118, 265, 118, 759, dll.)  
**Kode:**
```js
const placeholders = uniqueNames.map(() => '?').join(',');
const allFiles = db.prepare(`SELECT ... WHERE f.name IN (${placeholders})`).all(...uniqueNames);
```
Meskipun menggunakan `?` placeholder, jika `uniqueNames` berisi string yang tidak valid atau jika interpolasi dilakukan langsung pada `sortCol`/`sortDir`/`limit`, ada risiko injeksi.

**Lebih spesifik:**
```js
const sql = `... ORDER BY ${sortCol} ${sortDir}, f.id ASC LIMIT ${queryLimit}`;
```
`sortCol`, `sortDir`, dan `queryLimit` diinterpolasi langsung ke SQL tanpa sanitasi penuh. Meskipun `sortCol` dipetakan, `limit` hanya di-parse secara kasar (`parseInt(limit) || 10000`), dan jika `sortCol` atau `sortDir` dimanipulasi, bisa terjadi injeksi.

**Dampak:** Tinggi — dapat mengubah query SQL, membaca data tidak seharusnya, atau merusak database.

---

#### B2 — Potensi Null Pointer / Crash saat `MEDIA_ROOT` Kosong
**Lokasi:** `routes/playlists.js` (baris 96-104, 240-248)
```js
const commonParent = MEDIA_ROOT.length > 0
  ? MEDIA_ROOT.reduce((a, b) => { ... })
  : '';
```
Jika `MEDIA_ROOT` tidak didefinisikan atau kosong tetapi masih diakses, `reduce` akan gagal atau menghasilkan `''`. Ini sudah ditangani dengan `length > 0`, tetapi jika `MEDIA_ROOT` bukan array (misalnya `null` atau `undefined`), `.length` akan melempar error.

---

#### B3 — Heuristik Resolusi File Rentan Terhadap Kolisi Nama
**Lokasi:** `routes/playlists.js` (baris 112-143, 258-287)
Backend menggunakan heuristik multi-langkah untuk menemukan `dbFile`:
1. `location` (/file/<id>)
2. `normPath` (path relatif)
3. `rp` (path lengkap)
4. `fname` (nama file saja, hanya jika tidak ada kolisi)

Jika ada dua file dengan nama sama (`song.mp3`) di folder berbeda, heuristik akan salah memilih file. Ini sudah ditangani dengan `nameCount`, tetapi logika ini kompleks dan rawan kesalahan saat `MEDIA_ROOT` memiliki banyak root.

---

#### B4 — Import XSPF Tidak Memvalidasi File dengan Cukup Ketat
**Lokasi:** `routes/playlists.js` (baris 1027-1125)
`busboy` membatasi `fileSize: 10MB` dan `files: 1`, tetapi tidak memvalidasi konten file sebelum menulis ke `tmpPath`. Jika file berbahaya (misalnya bukan XSPF tetapi berisi script), `parseXSPF` mungkin gagal atau memicu error yang tidak tertangani dengan baik meskipun ada `try/catch`.

---

### 4.2 Bug Logika / Fungsional

#### B5 — Sorting pada `/play` Tidak Konsisten dengan `GET /:id`
Pada `GET /:id`, `trackList` tidak menerapkan sorting berdasarkan query params. Pada `GET /:id/play`, sorting diterapkan (`sortBy`, `sortOrder`). Ini bisa menyebabkan daftar track berbeda antara tampilan detail dan antrian pemutaran jika pengguna tidak menyadari parameter query.

---

#### B6 — Bulk Delete Tidak Memperbarui Statistik Playlist dengan Benar (Potensi)
Pada `POST /:id/tracks/delete`, statistik diperbarui menggunakan `stmts.getPlaylistTrackStats.get(playlistId)` setelah penghapusan, tetapi tidak ada verifikasi bahwa semua track yang dihapus benar-benar hilang sebelum menghitung ulang statistik.

---

#### B7 — `normalizePathForDedup` Rentan Terhadap Path yang Tidak Standar
Fungsi ini menggunakan regex dan `toLowerCase()`. Jika path berisi karakter khusus atau encoding berbeda, deduplikasi bisa gagal, menyebabkan track duplikat ditambahkan ke playlist.

---

#### B8 — Kode `Music.jsx` Mengandung Logika Sinkronisasi yang Sangat Kompleks dan Rentan
Komponen ini bukan hanya pemutar musik, melainkan sistem sinkronisasi real-time. Ada banyak state machine (`mode: 'IDLE' | 'LOCKED' | 'GRACE' | 'RECOVERY'`), memori drift, pipeline, scheduler, decoder, serta analisa sensor. Ini sangat rentan terhadap:
- Kondisi balapan (race condition) antara tick dan event seek/play
- Kebocoran memori jika `executionQueue` atau memori tidak dibersihkan dengan benar
- Crash jika `syncCore` atau `audioCurrentTime` tidak tersedia

---

### 4.3 Masalah Performa & Skalabilitas

- **Frontend:** `Music.jsx` sangat besar, akan lambat untuk diproses oleh bundler dan runtime React.
- **Backend:** `routes/playlists.js` menggunakan query SQL yang kompleks dan beberapa operasi dalam transaksi (`tx`). Jika playlist memiliki ribuan track, operasi `GET /:id` dan resolusi file akan lambat karena `N+1` query yang dioptimalkan dengan heuristik, tetapi masih bergantung pada `dbFile` lookup per track.
- **Scan Folder:** `scanDir` menggunakan `readdirSync` dan `statSync` secara sinkron, yang akan memblokir event loop jika folder sangat besar.

---

## 5. Alur Kerja Lengkap — Menu Music

### 5.1 Diagram Alur (Sederhana)

```
[Frontend] User klik Music
    ↓ GET /api/playlists
[Backend] routes/playlists.js → DB → JSON
    ↓ User pilih playlist
[Frontend] GET /api/playlists/:id
[Backend] DB → resolusi file (heuristik) → JSON
    ↓ User tekan Play
[Frontend] GET /api/playlists/:id/play (+ sortBy/sortOrder)
[Backend] Filter file_exists → heuristik file → sort queue → JSON
    ↓ Frontend memuat audio/video
[Frontend] Music.jsx → createVideoSyncEngine → tick (30ms)
    ↓ Telemetry, drift, memori, analisa, keputusan (soft/hard seek)
    ↓ Sinkronisasi berlanjut hingga track selesai / pengguna berhenti
```

---

## 6. Rekomendasi Perbaikan (Prioritas)

| Prioritas | Bug / Masalah | Rekomendasi Singkat |
|---|---|---|
| **P1** | B1 — SQL Injection | Gunakan parameterized query untuk semua bagian dinamis (`sortCol`, `sortDir`, `limit`). Jangan interpolasi string langsung. |
| **P1** | B3 — Resolusi File Rentan | Perbaiki heuristik dengan memastikan indeks lengkap (`dir_path/name`) selalu tersedia, dan batasi fallback nama-file hanya jika benar-benar unik. |
| **P2** | B4 — Import XSPF | Tambahkan validasi MIME/type dan batasi ukuran lebih ketat. Gunakan parser yang lebih aman. |
| **P2** | B5 — Sorting Tidak Konsisten | Pastikan `GET /:id` dan `/play` menggunakan logika sorting yang sama, atau dokumentasikan perbedaan dengan jelas. |
| **P2** | B7 — Dedup Path | Standarisasi semua path sebelum dedup (`normalizePath`) dan tambahkan logika fallback yang lebih eksplisit. |
| **P3** | B6 — Bulk Delete | Verifikasi statistik setelah operasi dalam transaksi yang sama, bukan setelah `tx()` selesai. |
| **P3** | B8 — Music.jsx Kompleks | Pisahkan logika sinkronisasi ke modul terpisah (`syncEngine.js`) dan kurangi tanggung jawab komponen utama. Tambahkan unit test untuk state machine. |
| **P3** | Performa Scan Folder | Ubah `scanDir` menjadi asinkron (`readdir`) atau batasi kedalaman rekursi. |

---

## 7. Kesimpulan

Menu Music (`Music.jsx` + `routes/playlists.js`) adalah bagian paling kompleks dari aplikasi `homelab-media-server`.  
- **Kerumitan tinggi** berasal dari integrasi sinkronisasi video/audio real-time di frontend dan logika resolusi file serta CRUD playlist yang kompleks di backend.  
- **Bug yang teridentifikasi** mencakup potensi SQL injection, kerentanan heuristik file, masalah deduplikasi path, serta kompleksitas kode yang sangat tinggi yang meningkatkan risiko bug tersembunyi.  
- **Tidak ada bukti bug runtime kritis** yang sudah terkonfirmasi dalam kode yang dibaca, tetapi struktur kode menunjukkan beberapa titik rentan yang perlu diperbaiki segera.

Laporan ini dapat digunakan sebagai dasar untuk perencanaan refactoring atau penambahan test coverage pada bagian Music.
