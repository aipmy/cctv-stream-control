# CCTV Monitoring Lite

Dashboard CCTV untuk LAN/VPN dengan React/Vite, Express, penyimpanan JSON, FFmpeg, dan kontrol PTZ ONVIF.

## Fitur

- Setup instalasi baru melalui wizard administrator pertama.
- Role `admin`, `teknisi`, dan `guest`.
- Kamera dan pengguna berasal dari backend, tanpa seed atau fallback dummy.
- Restream RTSP ke HLS/MJPEG agar dapat diputar browser.
- Probe kamera, metrik bandwidth, dan manajemen stream.
- PTZ ONVIF dengan koneksi standar dan fallback WS-Security time-shift.
- Credential kamera dan password pengguna tidak dikirim kembali melalui API.

## Kebutuhan

- Node.js 20 atau lebih baru
- npm
- FFmpeg dan FFprobe
- PM2 untuk production

```bash
node --version
ffmpeg -version
ffprobe -version
```

## Development

Siapkan backend:

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

Jalankan frontend dari terminal lain:

```bash
npm install
npm run dev:frontend
```

Buka `http://localhost:8080`. Pada instalasi kosong, aplikasi meminta pembuatan akun pertama. Role akun tersebut selalu `admin`; tidak ada username atau password default.

## Production

Edit `backend/.env`, terutama `AUTH_SECRET`, `CORS_ORIGIN`, dan lokasi data bila diperlukan.

```bash
npm install
npm --prefix backend install
npm run build
pm2 start ecosystem.config.cjs
pm2 save
```

Buka `http://IP_SERVER:4200`.

Deploy berikutnya dapat memakai:

```bash
./deploy.sh
```

Script tersebut membackup `backend/data` ke `backend/backups/data_YYYYMMDD_HHMMSS` sebelum build dan restart PM2.

## Data Dan Migrasi

- Kamera: `backend/data/cameras.json`
- Pengguna: `backend/data/users.json`
- HLS sementara: `backend/storage/hls`
- Log FFmpeg: `backend/logs/ffmpeg-stream.log`

Instalasi baru membuat file kamera dan pengguna sebagai array kosong. File lama tetap dibaca tanpa reset atau seed ulang.

Backup manual:

```bash
cp -a backend/data "backend/data_backup_$(date +%Y%m%d_%H%M%S)"
```

Format password lama tetap didukung. Password masih disimpan dalam format legacy di file JSON, tetapi tidak dikeluarkan lewat respons API atau log. Batasi akses file data pada user service dan gunakan LAN/VPN.

## Kamera

Tambahkan kamera dari menu **Kamera**. Contoh umum:

```text
Source Type : RTSP+ONVIF
RTSP Port  : 554 atau 8554
ONVIF Port : 80 atau 8000
Path       : /Streaming/Channels/101
Output     : HLS Stable
```

Password kosong saat mengedit berarti password tersimpan tidak berubah. Gunakan opsi **Hapus password kamera** untuk menghapusnya secara eksplisit.

Browser tidak membuka RTSP langsung. Endpoint restream:

```text
/api/streams/:cameraId/index.m3u8
/api/streams/:cameraId/video.mjpg
```

Jika HLS gagal karena codec, pilih HLS mode `transcode`. Default `copy` lebih ringan. Jangan mengaktifkan opsi timeout FFmpeg yang tidak didukung build server; default `RTSP_TIMEOUT_OPTION=none`.

## PTZ ONVIF

Aktifkan `RTSP+ONVIF` dan PTZ pada kamera. Tombol **Test ONVIF/PTZ** di form edit menampilkan:

- mode `standard` atau `ws-security-time-shift`
- jumlah profil
- profile token
- warning terstruktur

Backend mencoba koneksi standar lebih dulu. Jika discovery awal diputus kamera, backend membuat client terautentikasi dengan time-shift server, menemukan service/profile, lalu menyimpan Promise koneksi berdasarkan konfigurasi kamera. Cache dibuang saat kamera berubah, dihapus, atau koneksi gagal. Command move dan stop diserialkan per kamera.

Tuning tersedia di `backend/.env`:

```env
PTZ_CONNECT_TIMEOUT_MS=9000
PTZ_SOCKET_TIMEOUT_MS=5000
PTZ_COMMAND_TIMEOUT_MS=1800
PTZ_MOVE_DURATION_MS=650
PTZ_SPEED=0.35
PTZ_CLIENT_CACHE_MS=600000
```

## Hak Akses

| Aksi | Admin | Teknisi | Guest |
| --- | --- | --- | --- |
| Lihat kamera | Ya | Ya | Ya |
| Tambah/edit/probe/restart kamera | Ya | Ya | Tidak |
| PTZ | Ya | Ya | Tidak |
| Hapus kamera | Ya | Tidak | Tidak |
| Kelola pengguna | Ya | Tidak | Tidak |

Query `/api/users` hanya dijalankan untuk admin.

## API Setup Dan Sesi

```text
GET  /api/setup/status
POST /api/setup/admin
POST /api/auth/login
GET  /api/auth/me
```

`POST /api/setup/admin` hanya berhasil ketika storage pengguna benar-benar kosong. Percobaan kedua ditolak dengan HTTP `409`.

## Verifikasi

```bash
npm test
npm --prefix backend test
./node_modules/.bin/tsc -p tsconfig.app.json --noEmit
find backend/src -name '*.js' -print0 | xargs -0 -n1 node --check
npm run build
```

Status runtime:

```bash
curl http://127.0.0.1:4200/api/health
pm2 logs cctv-monitoring-lite --lines 150
tail -f backend/logs/ffmpeg-stream.log
```

## Keamanan

- Gunakan `AUTH_SECRET` acak dan panjang.
- Gunakan HTTPS/reverse proxy jika diakses di luar jaringan lokal.
- Batasi `CORS_ORIGIN`, firewall, dan permission `backend/data`.
- Token stream di query URL disensor dari access log.
- URL ber-credential, password, token, dan Bearer token disensor dari error/log.
