# Software Architecture & Module Contracts

Dokumen ini menjelaskan arsitektur terpisah (*Decoupled Architecture*) dari komponen-komponen Smart Detection pada aplikasi ini. Pemisahan ini ditujukan agar penggantian algoritma atau implementasi internal di satu modul tidak akan merusak modul lainnya (misalnya migrasi *Centroid Tracking* ke *ByteTrack* di masa depan).

## Alur Data Global (Data Flow)

```text
[RTSP Camera] 
    │
    ▼
1. Stream Manager
    │ (Frame + Metadata)
    ▼
2. Detector (Pixel & AI)
    │ (Daftar Deteksi Bounding Box)
    ▼
3. Object Tracker
    │ (Tracked Objects Stabil)
    ▼
4. Rule Engine (Zones & Excludes)
    │ (Filtered Event)
    ▼
5. Recording Service
    │
    ▼
[Notifikasi & Penyimpanan MP4]
```

---

## Kontrak Antar Modul (Module Contracts)

Untuk menjamin skalabilitas, setiap modul wajib mematuhi format *Input* dan *Output* (Kontrak) berikut ini:

### 1. Stream Manager (`streamManager.js`)
Bertugas sebagai jembatan yang menarik *stream*, mengatur *HLS*, dan mendistribusikan *Frame MJPEG* ke mesin deteksi.

- **Input:** RTSP URL & Konfigurasi Kamera (FPS, Resolusi Deteksi).
- **Output:** Buffer gambar JPEG utuh.
- **Tanggung Jawab Eksekusi:** Menentukan kapan modul *Detector* boleh dipanggil (mengatur *Hybrid Wake-up* dan *Cooldown*).

### 2. Detector (`motionEngine.js` & `aiDetector.js`)
Bertugas menerima satu gambar *statis* (JPEG) dan menebak objek apa saja yang ada di dalamnya tanpa memedulikan konteks frame sebelumnya.

- **Input:** JPEG Buffer + Sensitivitas Threshold.
- **Output (Kontrak Deteksi):**
  Array of Object, di mana setiap objek wajib memiliki format:
  ```json
  {
    "class": "person", 
    "score": 0.95,
    "bbox": [x, y, width, height],
    "frameWidth": 854,
    "frameHeight": 480
  }
  ```

### 3. Object Tracker (`objectTracker.js`)
Bertugas menautkan identitas objek antar frame yang berurutan. *Tracker* sama sekali tidak tahu dari mana data *bbox* itu berasal.

- **Input:** Hasil Output dari *Detector*.
- **Output (Kontrak Track):**
  Array of Object yang sudah distabilkan, wajib memiliki tambahan properti:
  ```json
  {
    "id": 1, 
    "centroid": { "x": 427, "y": 240 },
    "disappeared": 0,
    "history": [{ "x": 420, "y": 230 }, ...]
  }
  ```

### 4. Rule Engine (Terintegrasi di `streamManager.js`)
Bertugas menerima pergerakan objek dan mengevaluasinya terhadap garis *Tripwire*, zona *Intrusion*, atau daerah *Exclude*.

- **Input:** Hasil Output dari *Object Tracker* + *Smart Zones Configuration*.
- **Output:** Sinyal Boolean (*True/False*) apakah objek tersebut lolos kualifikasi untuk dijadikan "Kejadian/Event".

### 5. Recording Service (`recordingService.js`)
Bertugas menangani penyimpanan *Hardisk* dan notifikasi. Modul ini tidak tahu menahu tentang koordinat piksel atau kotak merah. Ia hanya bertindak berdasarkan perintah.

- **Input (Kontrak Event):** Perintah `triggerEvent(cameraId, reason)`.
- **Tanggung Jawab Eksekusi:**
  - Melakukan *extend* durasi rekaman (+15 detik).
  - Menyambungkan klip HLS menjadi MP4.
  - Memanggil *FCM Push Notification*.

---

## Future Roadmap: Smooth Rendering Pipeline

Saat ini, `MJPEG FPS` dan `AI FPS` terikat pada frekuensi yang sama (~2 FPS) demi kesederhanaan. Ke depannya, sistem akan mengadopsi arsitektur *Client-Side Interpolation* untuk memberikan *User Experience* yang sangat halus tanpa mengorbankan CPU Raspberry Pi.

**Target Arsitektur (Phase 2):**

1. **Decoupled FPS:**
   - FFmpeg memproduksi `MJPEG` pada 10 FPS untuk browser.
   - AI Sampler berjalan independen di 2 FPS.
2. **Tracker Upgrade (Kalman Filter / State Estimator):**
   - `ObjectTracker` tidak hanya menyimpan posisi, tapi menghitung `Velocity` (dx, dy).
   - Tracker melakukan *Prediction* (menebak posisi di frame sela) dan *Correction* (mengoreksi posisi saat AI selesai inferensi).
3. **Client-Side Rendering (Browser):**
   - Backend memancarkan SSE berisi `Track ID`, `Bounding Box`, `Velocity`, dan `Timestamp`.
   - Browser merender video MJPEG 10 FPS, dan menggunakan `requestAnimationFrame()` untuk meluncurkan animasi kotak merah (*Client-Side Interpolation*) berdasarkan *Velocity*.

Dengan arsitektur ini, Raspberry Pi tetap sedingin es (hanya memproses AI 2 FPS), sementara perangkat pengguna (Laptop/HP) akan menggunakan GPU lokal mereka untuk merender pergerakan *Bounding Box* sehalus 30/60 FPS.

---

## Prinsip Pengembangan Berbasis Data (Data-Driven Engineering)

Semua poin pada `Future Roadmap` di atas diperlakukan murni sebagai **Hipotesis Engineering**. Sebuah fitur baru tidak akan di-_merged_ secara permanen hanya karena "secara teori terdengar bagus" atau "secara visual terlihat halus".

Setiap implementasi besar wajib melewati siklus berikut:
`Problem ➔ Measurement ➔ Implementation ➔ Benchmark ➔ Decision`

### Standar Evaluasi Metrik (Performance Dashboard)

Setiap *Pull Request* atau *Commit* arsitektur besar harus diiringi dengan tabel perbandingan metrik kinerja secara objektif menggunakan spesifikasi *hardware* yang sama (misal: Raspberry Pi 4, 1 Kamera 1080p).

**Contoh Format Evaluasi Metrik:**

| Metric | Baseline (Sebelum) | Eksperimen (Sesudah) | Kriteria Keputusan |
| :--- | :--- | :--- | :--- |
| **CPU Usage (%)** | 42% | 44% | Kenaikan max < 5% |
| **RAM Usage (MB)** | 512 MB | 515 MB | Kebocoran memori < 10 MB |
| **MJPEG FPS** | 2 | 10 | Target Tercapai |
| **AI FPS** | 2 | 2 | Tetap Ringan |
| **Detection Latency** | 180 ms | 182 ms | Pertambahan wajar |
| **Browser FPS** | 2 | 10 | Lebih *Smooth* |
| **Miss Detection / ID Switch** | 1.8% | 1.7% | Akurasi tidak menurun |

Prinsip ini menjamin bahwa **kompleksitas kode tambahan sepadan dengan manfaat operasional** di dunia nyata. Optimasi harus selalu berbasis pada data (*Data-Driven*), bukan asumsi.
