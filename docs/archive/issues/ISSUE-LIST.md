# Daftar Issue Video Cache & Player

## Issue Terkini

### 1. Tinggi mode video saja tidak setinggi cover
**Status:** Fix  
**Deskripsi:** Saat mode video (tanpa split), tinggi video lebih tinggi dari cover. User ingin video memiliki tinggi yang sama dengan cover (~180px) dengan aspect ratio 16:9.  
**Harapan:** Video 16:9 dengan tinggi tetap seperti cover.

### 2. Mode video+lirik aspect ratio dan tinggi masih salah
**Status:** Fix  
**Deskripsi:** 
- Aspect ratio video masih salah (bukan 16:9)
- Tinggi video+lirik tidak konsisten dengan cover  
**Harapan:** Video 16:9 di kiri, lirik 1:1 di kanan, ketinggian kedua panel sama.

### 13. Cover gambar audio player terlalu tinggi, menutupi judul
**Status:** Fix
**Deskripsi:** Pada mode audio player (cover/lyrics), gambar cover membuka layar vertikal sepenuhnya sehingga judul dan kontrol terpotong atau terlalu bawah.
**Harapan:** Gambar cover harus berbentuk kotak dengan ukuran maksimal yang sesuai (mis. lebar maksimal `xs` atau sekitar 200‑320px tinggi) dan tidak menutupi elemen UI lain.
---

### 14. Video frame tidak sync dengan audio saat switch Cover ↔ Video cepat
**Status:** Fix
**Deskripsi:** Saat user switch mode Cover ↔ Video dengan cepat, frame video stuck di frame yang sama dan tidak sync dengan posisi audio. Video telat beberapa detik dari audio.
**Root Cause:**
1. Drift correction pakai `seekTo()` (serial queue) → di cover mode (`opacity: 0`), browser bisa gak fire `seeked` event → serial queue stuck.
2. Mode-switch effect pakai `forceSeek()` yang malah merusak posisi video.
3. Drift threshold 0.20s terlalu besar → video boleh telat sampai 0.20s sebelum di-sync.
**Fix:**
1. Drift correction pakai `forceSeek()` (bypass serial queue) → tidak ada stuck.
2. Drift correction jalan di SEMUA mode (hapus `isVideoMode` guard).
3. Threshold kecilkan ke 0.05s → video harus sangat ketat sync.
4. Mode-switch effect HANYA `playVideo()` (hapus `forceSeek`) → biarkan drift correction yang handle sync natural.
**Prinsip Penting:**
- **Video SELALU play di semua mode** (cover & video). Ini kunci supaya frame tetap sync.
- **Jangan pakai `seekTo()` di drift correction** → serial queue bisa stuck di cover mode.
- **Jangan pakai `forceSeek()` di mode-switch effect** → malah merusak posisi video.
- **Drift correction harus pakai `forceSeek()`** → bypass queue, langsung set `currentTime`.
**Jangan Ulangi:**
- Threshold drift correction jangan > 0.05s (telalu besar, video boleh telat).
- Jangan remove `isVideoMode` guard dari drift correction TANPA juga fix `playVideo()` guard di CachedVideoPlayer.
- Jangan pakai `setTimeout` untuk delay sync → user bisa cancel dengan cepat.
- Jangan pakai `isSeekingSyncRef` tanpa reset mechanism → video bisa stuck.

---

## Issue Sebelumnya

### 3. Progress bar tidak sinkron dengan video
**Status:** Fix (gunakan usePlaybackStore hook)  
**Deskripsi:** Progress bar video tidak mengikuti posisi audio/video.  
**Fix:** Gunakan `setPosition` dari store untuk sync waktu.

### 4. Klik pada lyrics mengganti mode
**Status:** Fix (tambahkan stopPropagation)  
**Deskripsi:** Saat klik pada area lyrics di mode video+lirik, mode berubah bukan tetap di lyrics.  
**Fix:** Tambahkan `onClick={(e) => e.stopPropagation()}` pada lyrics container.

### 5. Audio ganda di mode video
**Status:** Fix (tambahkan muted prop)  
**Deskripsi:** Audio terdengar ganda dari video dan musik player.  
**Fix:** Tambahkan `muted` prop pada elemen video.

### 6. YouTube ID terpotong saat disave
**Status:** Sudah benar (hanya ID yang disimpan)  
**Deskripsi:** User input URL penuh, hanya video ID yang tersimpan. Ini sudah benar karena hanya ID yang dibutuhkan untuk cache.

### 7. Status video di editor tidak akurat
**Status:** Fix  
**Deskripsi:** Status "cached", "downloading", "error" tidak konsisten.  
**Fix:** Perbaiki endpoint `/api/video-cache/progress/:youtubeId`.

### 8. Video masih "Failed to load video"
**Status:** Fix (tambahkan method: 'POST')  
**Deskripsi:** CachedVideoPlayer fetch tanpa POST method, sehingga endpoint tidak merespons.  
**Fix:** Tambahkan `{ method: 'POST' }` pada fetch.

---

## Issue Lainnya

### 9. Progress bar flickering tanpa update nyata
**Status:** Fix (poll ke progress endpoint)  
**Deskripsi:** Progress bar berubah tapi tidak ada download aktual.

### 10. Footer button "Tutup" ganda
**Status:** Fix  
**Deskripsi:** Ada tombol Tutup di semua tab, padahal sudah ada tombol X.  
**Fix:** Hanya tampilkan Batal/Simpan di tab Info.

### 11. Animasi cover tidak ada
**Status:** Perlu follow-up  
**Deskripsi:** Animasi zoom (scale 90-100) cover tidak terlihat.  
**Catatan:** Kelas `transition-all duration-700` sudah ada, mungkin masalah render.

### 12. Folder video cache tidak ada
**Status:** Sudah ada (backend/cache/videos/)  
**Deskripsi:** User mencari di `cache/videos/` padahal file di `backend/cache/videos/`.

**Status:** Fix
**Deskripsi:** Di menu Music web, cover audio player membuka lebar penuh layar bahkan menutup judul lagu, membuat judul tidak terlihat.
**Harapan:** Cover memiliki lebar maksimal (misal: max-w-xs) dan proporsi kotak 1:1 agar judul tetap terlihat.

---

### 15. Transisi cover ↔ video tidak mulus (cover mengintip atas/bawah)
**Status:** Fix
**Deskripsi:** Saat switch dari mode cover ke mode video, layer cover (kotak 1:1) lebih tinggi dari video (16:9). Karena keduanya fade terpisah, sisa atas/bawah cover masih terlihat selama transisi → tidak mulus.
**Fix:** Layer cover kini bermorph ke kotak 16:9 video yang SAMA (posisi center identik, `overflow-hidden` + `object-cover`) saat di mode video, dengan transisi `width/height 400ms`. Crossfade jadi seamless, tidak ada peek. Split mode (`video-split`/`video-cover`) tetap pakai geometri sub-kotaknya.
**File:** `frontend/src/components/AudioPlayer.jsx` (`coverBoxStyle`).

---

### 16. Editor Music: redownload video pakai format + hapus video
**Status:** Fix
**Deskripsi:** Tab Video di MetadataEditor hanya bisa download pakai format tetap. User mau: (1) detect format lalu pilih resolusi, (2) hapus video cache.
**Fix:**
- Backend `downloadVideo` terima `formatStr` (selector yt-dlp); route `POST /api/video-cache/download/:youtubeId` terima `body.format` + `?force`.
- Backend baru `deleteVideo(youtubeId)` + route `DELETE /api/video-cache/:youtubeId`.
- Frontend: tombol **Detect Format** (`POST /api/downloader/formats`), `<select>` resolusi video + opsi "Default", tombol **Redownload/Download**, dan **Hapus Video** (ConfirmModal) yang juga reset `youtube_id`.
**File:** `backend/src/utils/videoCache.js`, `backend/src/routes/videoCache.js`, `frontend/src/components/MetadataEditor.jsx`.
