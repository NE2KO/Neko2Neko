# WhatsApp Status — Investigasi & Hasil Akhir

> Catatan lengkap investigasi status WhatsApp (foto/video/teks) via bot, dari
> awal sampai solusi final. Tanggal: 2026-07-14. Status: **SELESAI — bot murni pengirim**.

---

## Kesimpulan singkat (TL;DR)

- **Kirim status (teks/foto/video) SELALU berhasil** secara teknis: `messageSendResult:"OK"`, `msgAck:1`.
- **Bukan bug kode pengiriman.** `Utils.js` sudah identik dengan PR #201816 (terverifikasi e2e).
- **`messageSecret` = red herring**, sudah di-revert.
- **ROOT CAUSE (awal):** bot disconnected → kiriman gagal. Setelah reconnect, kiriman jalan.
- **ROOT CAUSE (utama): salah alamat JID.** `normalizeJid()` (lama) menganggap semua nomor
  Indonesia, sehingga nomor internasional tanpa kode negara (`85805271829`) disimpan mentah
  sebagai `85805271829@c.us` / `6285805271829@c.us` (phantom/unsaved) alih-alih kanonik
  `85285805271829@c.us`. Status `OK`+`ack:1` tapi **tidak sampai ke penerima**.
- **DESIGN FINAL (yang dipakai):** privasi status adalah **setelan akun** (sama di HP/Web/bot).
  Bot **tidak mengelola audiens sama sekali** — murni `sendMessage(status@broadcast,…)` dan WA
  yang membaca setelan akun saat kirim. `STATUS_AUDIENCE`, `applyStatusAudience()`, dan
  `normalizeJid()` **seluruhnya dihapus**. Endpoint `_setprivacy` hanya alat debug.

---

## Lingkungan

- Bot WA berjalan **di dalam proses backend** (`backend/src/server.js`), bukan proses
  `whatsapp-bot/src/index.js` terpisah.
- Backend melayani **HTTPS** di port **3001** → curl pakai `https://127.0.0.1:3001 -k`.
- Sesi puppeteer: `whatsapp-bot/.wwebjs_auth/session-whatsapp-bot-session`.
- `whatsapp-web.js` versi **1.34.7** (patch LID di `node_modules/whatsapp-web.js/src/util/Injected/Utils.js`).
- Backend dijalankan dengan `node --watch` → edit `backend/src` memicu restart & reconnect.

### Identitas akun (era LID)
- `getMeDeviceLidOrThrow()` = `202860096684094:62@lid` (device LID)
- `getMaybeMeLidUser()`     = `202860096684094@lid` (LID user)
- `getMaybeMePnUser()`      = `6285833216318@c.us` (PN)

---

## Timeline lengkap (2026-07-14)

| Fase | Aksi | Audiens | Hasil |
|---|---|---|---|
| 1 | foto (NSFW) + teks | Kontak saya / ALL | foto **render** → ke semua kontak (kaget) |
| 1 | user set privasi → allow-list [nomor mati] | — | — |
| 1 | video | allow-list (nomor mati) | "ga ada" |
| 1 | edit `messageSecret` ke `mediaMsgData` + restart | — | regresi media rusak |
| 1 | **revert `messageSecret`** + restart | — | kembali normal |
| 1 | teks "test" | ALL_CONTACTS (programatik) | **muncul** ✅ |
| 2 | **dua proses backend** jalan barengan → rebut sesi → `pupPage` detached | — | semua `evaluate` gagal |
| 2 | kill duplikat, jalankan **1 backend** segar | — | `evaluate` jalan lagi |
| 2 | set allow-list [6282378484390] (nomor blokir) → kirim teks | allow-list | `OK`/`ack:1` |
| 3 | set allow-list [85272195427] (HK, ada `852`) → kirim | allow-list | `OK`/`ack:1` |
| 3 | set allow-list [85805271829] (HK, **tanpa 852**) → kirim | allow-list | `OK`/`ack:1` tapi "ga ada" |
| 4 | observasi: allow-list tampil sebagai nomor **unsaved/phantom**, bukan kontak tersimpan | — | petunjuk JID salah |
| 4 | hipotesis LID/PN: owner-view tidak render allow-list | — | (nanti dibuktikan bukan penyebab utama) |
| 5 | **ROOT CAUSE**: `normalizeJid` salah → JID phantom | — | status nyasar ke JID bukan kontak asli |
| 5 | bukti: set allow-list langsung ke `85285805271829@c.us` → HP tampil **+852 85805271829**, penerima terima "TEST 4" | allow-list (kanonik) | ✅ sampai ke penerima |
| 5 | perbaiki `normalizeJid` (jangan asumsi Indonesia) + tambah `STATUS_AUDIENCE` di `.env` (apply otomatis saat connect) | file-based | berfungsi |
| 6 | **DESIGN FINAL**: bot tdk perlu atur audiens; HP yg pegang. Hapus `applyStatusAudience`, `normalizeJid`, `STATUS_AUDIENCE` | HP-controlled | bot murni pengirim |
| 6 | user set HP "Hanya bagikan dengan 1 nomor" → bot kirim "TEST 5/6" | allow-list (HP) | `OK`, ikut setelan HP |
| 6 | user set HP "Kontak saya, kecuali…" → bot kirim "TEST 7"–"TEST 12" | deny-list (HP) | `OK`, ikut setelan HP |

---

## Root Cause (FINAL)

### 1. Bukan kegagalan kirim
Semua status mengembalikan `messageSendResult:"OK"`, `msgAck:1`. Server menerima.
```json
{ "messageSendResult": "OK", "msgAck": 1,
  "msgId": "true_status@broadcast_..._202860096684094@lid" }
```
(msgId di-rebuild ke `@lid` oleh WA — benar.)

### 2. Penyebab "ga ada" = allow-list menunjuk ke JID SALAH (phantom/unsaved)
`normalizeJid()` (lama) menganggap semua nomor Indonesia. Nomor HK `85805271829`
(tanpa kode negara) disimpan mentah sebagai `85805271829@c.us`, atau malah
`6285805271829@c.us` kalau yang normalisasi adalah HP (default negara ID).
Padahal JID kanonik kontak adalah **`85285805271829@c.us`**.

Server mengirim status ke JID di allow-list. Karena JID salah → status pergi ke nomor
phantom/unsaved → **penerima asli tidak dapat**, dan view "Status saya" (mode allow-list)
tidak ke-render. Kirim tetap `OK`+`ack:1` (server terima), cuma **salah alamat**.

### 3. Bukti eksperimen (paling solid)
Set allow-list **langsung** ke `85285805271829@c.us` (tanpa lewat `normalizeJid`)
→ di HP tampil **+852 85805271829** (kontak dikenali, bukan unsaved) dan penerima
menerima "TEST 4". Satu-satunya variabel yang berubah = JID benar → konklusi pasti.

### 4. `messageSecret` = red herring (sudah di-revert)
Menyuntik `messageSecret: Uint8Array(32)` mentah ke `mediaMsgData` menimpa penanganan
internal `sendStatusMediaMsgAction` → media malformed. Jalur teks tidak pernah menerima
messageSecret; action WA menangani sendiri.

### 5. FIX final (diterapkan): bot tidak mengelola audiens
`normalizeJid()`, `applyStatusAudience()`, dan config `STATUS_AUDIENCE` **dihapus**.
Privasi status adalah setelan akun (HP/Web/bot sama) — bot cukup
`sendMessage(status@broadcast,…)` dan WA yang membaca setelan akun saat kirim.

---

## Verifikasi kode vs PR referensi

Diff `node_modules/whatsapp-web.js/src/util/Injected/Utils.js` (terpasang) vs commit final
PR #201816 (`cabfc6c`):
- Cabang `isStatus` **identik secara fungsional**
  (media: `sendStatusMediaMsgAction({ mediaMsgData, beforeSend, funnelContext })`;
  teks: `sendStatusTextMsgAction(statusOptions)`).
- Beda hanya kosmetik/lokal (channel-media `avParams()` fallback, wrapper debug `window.__lastStatus`).
- `Utils.js` sudah dikembalikan ke kondisi asli (identik PR). **Net perubahan = nol.**

---

## Mekanisme Privasi Status (audiens) — setelan akun

Audiens status = **setelan global akun**, bukan per-post. Semua device di akun yang sama
(HP, WA Web, bot) berbagi setelan ini. Bot mengikutinya otomatis saat mengirim.

### Enum tipe (`WAWebWamEnumStatusPrivacyType.STATUS_PRIVACY_TYPE`)
```
ALL_CONTACTS = 1   (setting string: "contact")
EXCEPT       = 2   (setting string: "deny-list" / "allow-list"? depends — lihat di bawah)
ONLY_WITH    = 3   (setting string: "allow-list")
CLOSE_FRIENDS= 4
CUSTOM_LIST  = 5
```
> Catatan: di sesi ini `setting` yang terlihat: `"contact"` (ALL), `"allow-list"`
> (ONLY_WITH), `"deny-list"` (EXCEPT/Kontak saya kecuali). String persis bergantung
> versi WA Web; yang penting adalah nilai enum & behaviour.

### API internal WA Web (hanya untuk debug via `_setprivacy`)
- `WAWebStatusPrivacySettingAction.getStatusPrivacySetting()` → `{ setting, allowList[], denyList[] }`
- `WAWebStatusPrivacySettingAction.setStatusPrivacyContact(type)` → set mode
- `WAWebStatusPrivacySettingAction.setStatusPrivacyAllowList(wids[])` → "Hanya bagikan dengan"
- `WAWebStatusPrivacySettingAction.setStatusPrivacyDenyList(wids[])` → "Kontak saya kecuali"
- `WAWebWidFactory.createWid('628...@c.us')` → bangun WID dari string

### Yang terbukti bekerja (lewat debug, sebelum dihapus dari produksi)
- `setStatusPrivacyContact(ALL_CONTACTS)` → `setting:"contact"` ✅
- `setStatusPrivacyAllowList([createWid('628980220740@c.us')])` → `setting:"allow-list"` ✅
- `setStatusPrivacyAllowList([createWid('85285805271829@c.us')])` → HP tampil `+852 85805271829`, penerima menerima ✅

---

## Desain Produksi (FINAL)

```
HP atur privasi Status (Kontak saya / Kecuali / Hanya bagikan dengan)
        ▼  disimpan di server WA (setelan akun, sama untuk semua perangkat)
        ▼
Bot: client.sendMessage("status@broadcast", media, {caption})
        ▼
WA membaca setelan akun saat kirim → status mengikuti pilihan di HP
```

Bot **tidak** memanggil `setStatusPrivacyAllowList` / `setStatusPrivacyContact`.
Ini sesuai desain WA: semua device di akun yang sama berbagi setelan privasi yang sama,
jadi tidak ada konflik antar-device.

### Verifikasi lintas mode (semua ikuti setelan HP, bot tidak ubah apa-apa)
| Setelan HP | Bot kirim | Hasil |
|---|---|---|
| Hanya bagikan dengan 1 nomor (`6282378484390`, yang blokir) | TEST 5/6 | `OK`/`ack:1`, tidak tampil ke dia (wajar, diblokir) |
| Kontak saya, kecuali… (`deny-list`, 17 kontak) | TEST 7–12 | `OK`/`ack:1`, mengikuti deny-list |

---

## Endpoint diagnostik (sementara, di `backend/src/routes/whatsapp.js`)

| Endpoint | Fungsi | Sifat |
|---|---|---|
| `POST /api/whatsapp/debug-statusprivacy` | Baca setelan privasi + enum + introspeksi | read-only |
| `POST /api/whatsapp/debug-msg` `{id}` | Lookup pesan by id (ack/mediaStage) | read-only |
| `POST /api/whatsapp/debug-statuscoll` | Baca `window.__lastStatus` (hasil kirim terakhir) | read-only |
| `POST /api/whatsapp/_setprivacy` | **Menulis** setelan privasi | WRITE — **hanya debug** |

> `Utils.js` sudah dikembalikan ke kondisi asli (identik PR). Net perubahan = nol.
>
> **Status audience TIDAK dikelola bot di produksi.** `STATUS_AUDIENCE`,
> `applyStatusAudience()`, dan `normalizeJid()` **sudah dihapus** dari
> `connection.js` / `config.js` / `backend/.env`. Bot murni pengirim; audiens 100%
> dari setelan akun (HP). `_setprivacy` tetap ada sebagai alat debug, bukan alur harian.

---

## Cara pakai (cheat-sheet)

Prasyarat: `curl -sk https://127.0.0.1:3001/api/whatsapp/status` → `"connected":true`.
`BASE=https://127.0.0.1:3001/api/whatsapp`

```bash
# 1. Cek setelan audiens saat ini (read-only, tidak mengubah)
curl -sk -X POST $BASE/debug-statusprivacy -d '{}' -H 'Content-Type: application/json'

# 2. (Debug saja) ubah audiens lewat _setprivacy — JANGAN untuk produksi
curl -sk -X POST $BASE/_setprivacy -H 'Content-Type: application/json' \
  -d '{"mode":"allowlist","numbers":["6282378484390@c.us"]}'

# 3. Kirim status (teks / media) — bot murni pengirim, ikut setelan HP
curl -sk -X POST $BASE/test-status -H 'Content-Type: application/json' -d '{"text":"test"}'
curl -sk -X POST $BASE/test-status -H 'Content-Type: application/json' -d '{"path":"/path/ke/foto.jpg"}'

# 4. Cek hasil kirim terakhir (harus messageSendResult=OK, msgAck=1)
curl -sk -X POST $BASE/debug-statuscoll -d '{}' -H 'Content-Type: application/json'
```

Ubah audiens di **HP** (Setelan → Privasi → Status). Bot otomatis mengikutinya.

Codec video status aman: **H.264 mp4**. HEVC/webm bisa gagal
(lihat `normalizeWaError` di `whatsapp-bot/src/sender.js`).

---

## File terkait & perubahan

- `whatsapp-bot/src/connection.js` — bot connect; **dihapus** `normalizeJid`,
  `withPageRetry`, `applyStatusAudience()` & panggilannya di `on('ready')`.
- `whatsapp-bot/config.js` — **dihapus** field `statusAudience`.
- `whatsapp-bot/src/sender.js` — `sendMediaToStatus`, `sendTextToStatus`, `normalizeWaError`
  (tidak diubah; jalur kirim tetap).
- `whatsapp-bot/node_modules/whatsapp-web.js/src/util/Injected/Utils.js` — patch LID status;
  **dikembalikan** ke identik PR #201816 (net nol).
- `backend/.env` — **dihapus** baris `STATUS_AUDIENCE`.
- `backend/src/routes/whatsapp.js` — endpoint `test-status` (kirim), `debug-statusprivacy`,
  `debug-msg`, `debug-statuscoll` (read-only), `_setprivacy` (debug WRITE).

---

## TODO (opsional)
- [ ] Putuskan nasib endpoint debug (`_setprivacy` dkk): hapus vs jadikan permanen.
- [ ] (Opsional) patch permanen `Utils.js` (`patch-package`) agar tidak hilang saat `npm install`.
- [ ] (Opsional) kontrol audiens di UI Bot — **tidak direkomendasikan**; biarkan HP yang pegang
      agar tidak ada konflik antar-device.
