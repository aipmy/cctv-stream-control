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
