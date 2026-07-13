# Code Review Questions - Hybrid Wake-up AI

Pertama, saya suka dengan perubahan arsitektur ini. Secara konsep sudah jauh lebih efisien dibanding Continuous AI karena sekarang AI memiliki lifecycle (Wake → Sustain → Sleep).

Sebelum saya menyatakan implementasi ini benar-benar final, saya ingin memastikan beberapa detail implementasinya.

---

## 1. Tracker Lifecycle

Bagaimana lifecycle `ObjectTracker`?

Contoh kasus:

```
Person masuk
↓
Terdeteksi AI
↓
Tracker aktif
↓
Orang duduk diam selama 15 menit
```

### Pertanyaan

- Apakah tracker akan tetap hidup selama object masih terlihat?
- Apakah ada timeout?
- Kalau timeout, berapa detik?
- Apa yang menyebabkan tracker dianggap "lost"?

Misalnya:

- confidence turun?
- object keluar frame?
- IoU terlalu kecil?
- tidak ada validasi AI beberapa kali?

---

## 2. AI Sustain Interval

Saat tracker masih aktif, AI melakukan validasi ulang seberapa sering?

Contoh:

- setiap frame?
- setiap 200 ms?
- setiap 500 ms?
- setiap 1 detik?
- adaptive?

Karena parameter ini akan sangat mempengaruhi CPU Raspberry Pi.

---

## 3. AI Scheduler Logic

Saya ingin memastikan kondisi AI "bangun".

Apakah logikanya seperti ini?

```javascript
if (
    motionDetected ||
    tracker.hasActiveTracks() ||
    cooldown.isRunning()
) {
    runAI();
} else {
    sleepAI();
}
```

Atau menggunakan logika lain?

---

## 4. Multi Object

Bagaimana jika ada lebih dari satu object?

Misalnya:

```
Person A diam

Person B masuk

Dog lewat
```

Apakah scheduler tetap hanya menjalankan satu inferensi?

Atau setiap object memiliki lifecycle masing-masing?

Bagaimana ObjectTracker mengelola banyak Track ID secara bersamaan?

---

## 5. Tracker Confidence

Jika tracker confidence mulai turun, apa yang dilakukan sistem?

Misalnya:

```
0.95

↓

0.80

↓

0.60

↓

0.40
```

Apakah:

- langsung menjalankan AI?
- menunggu motion?
- menghapus track?
- melakukan re-detection?

---

## 6. Camera Shake

Bagaimana jika kamera bergoyang karena angin?

Contoh:

- kamera outdoor
- seluruh frame berubah
- Pixel Motion aktif terus

Apakah ada mekanisme seperti:

- global motion compensation
- adaptive threshold
- ignore full-frame movement
- debounce motion

Agar AI tidak terus terbangun karena seluruh frame bergerak.

---

## 7. CPU Adaptive Scheduler (Opsional)

Apakah scheduler mempertimbangkan beban Raspberry Pi?

Misalnya:

```
CPU < 40%
AI = 5 FPS

CPU 60%
AI = 3 FPS

CPU 80%
AI = 2 FPS

CPU > 90%
AI = 1 FPS
```

Menurut saya fitur ini akan sangat membantu ketika ada beberapa kamera aktif bersamaan.

---

## 8. Cooldown

Saat cooldown 5 detik berjalan:

Misalnya:

```
Motion selesai

↓

Cooldown 5 detik

↓

Tiba-tiba ada motion lagi
```

Apakah:

- cooldown langsung dibatalkan?
- timer di-reset?
- AI tetap hidup?

---

## 9. Recording Integration

Karena project ini juga memiliki Recording Service.

Saya ingin memastikan:

Apakah AI hanya mengirim Event?

```
AI

↓

Event

↓

Recording Service
```

atau AI ikut mengontrol recording secara langsung?

Menurut saya lebih baik AI hanya menghasilkan event, sedangkan Recording Service yang memutuskan apakah perlu:

- extend recording
- save snapshot
- trigger notification
- update metadata

---

## 10. AI Queue

Bagaimana jika inferensi sebelumnya belum selesai?

Misalnya:

```
Frame 1
AI Running

↓

Frame 2 datang

↓

Frame 3 datang
```

Apakah:

- frame terbaru menggantikan frame lama (drop old frame)?
- semua frame dimasukkan ke queue?
- hanya menyimpan latest frame?

Untuk Raspberry Pi saya lebih menyukai strategi **Latest Frame Only**, supaya AI selalu bekerja pada kondisi terbaru dan tidak tertinggal.

---

# Kesimpulan

Menurut saya arsitektur **Hybrid Wake-up AI** ini sudah sangat baik.

Saya hanya ingin memastikan implementasi scheduler, tracker, dan lifecycle AI benar-benar robust untuk kondisi nyata seperti:

- object diam lama
- banyak object
- kamera outdoor
- CPU tinggi
- tracker kehilangan object
- queue inference
- recording yang berjalan bersamaan
