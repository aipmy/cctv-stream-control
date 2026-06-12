const GENERIC_ERROR = {
  code: "STREAM_UNAVAILABLE",
  message: "Stream kamera tidak dapat diproses. Periksa koneksi dan konfigurasi kamera.",
};

export function classifyStreamError(value) {
  const text = String(value || "");
  if (!text.trim()) return null;

  if (/frame MB size.+level limit|error while opening encoder|failed to open encoder|height not divisible by 2/i.test(text)) {
    return {
      code: "ENCODER_INCOMPATIBLE",
      message: "Resolusi atau codec kamera tidak kompatibel dengan profil transcode.",
    };
  }
  if (/401 unauthorized|method describe failed:\s*401|authentication failed|unauthorized/i.test(text)) {
    return {
      code: "SOURCE_AUTH_FAILED",
      message: "Autentikasi kamera ditolak. Periksa username dan password kamera.",
    };
  }
  if (/connection timed out|network timeout|timed out|etimedout/i.test(text)) {
    return {
      code: "SOURCE_TIMEOUT",
      message: "Koneksi ke kamera timeout. Periksa IP, port, jaringan, dan status kamera.",
    };
  }
  if (/connection refused|econnrefused/i.test(text)) {
    return {
      code: "SOURCE_REFUSED",
      message: "Koneksi kamera ditolak. Periksa IP, port RTSP, dan layanan kamera.",
    };
  }
  if (/no route to host|network is unreachable|ehostunreach|enetunreach/i.test(text)) {
    return {
      code: "SOURCE_UNREACHABLE",
      message: "Kamera tidak dapat dijangkau dari server. Periksa jaringan dan alamat IP.",
    };
  }
  if (/404 not found|server returned 404|method describe failed:\s*404/i.test(text)) {
    return {
      code: "SOURCE_NOT_FOUND",
      message: "Path stream kamera tidak ditemukan. Periksa RTSP path kamera.",
    };
  }
  if (/invalid data found|could not find codec parameters|unsupported codec/i.test(text)) {
    return {
      code: "SOURCE_FORMAT_UNSUPPORTED",
      message: "Format video kamera tidak didukung. Coba mode transcode atau substream H.264.",
    };
  }
  return GENERIC_ERROR;
}
