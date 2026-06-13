import { useLangStore } from "@/features/ui/useLangStore";
import { translations, type TranslationKey } from "@/lib/locales";

const errorTranslations: Record<string, string> = {
  "Autentikasi kamera ditolak. Periksa username dan password kamera.": 
    "Camera authentication denied. Verify the camera username and password.",
  "Koneksi ke kamera timeout. Periksa IP, port, jaringan, dan status kamera.": 
    "Camera connection timed out. Verify the IP address, port, network connectivity, and camera status.",
  "Koneksi kamera ditolak. Periksa IP, port RTSP, dan layanan kamera.": 
    "Camera connection refused. Verify the IP address, RTSP port, and camera service.",
  "Kamera tidak dapat dijangkau dari server. Periksa jaringan dan alamat IP.": 
    "Camera is unreachable from the server. Verify the network and IP address.",
  "Path stream kamera tidak ditemukan. Periksa RTSP path kamera.": 
    "Camera stream path not found. Verify the camera RTSP path.",
  "Format video kamera tidak didukung. Coba mode transcode atau substream H.264.": 
    "Camera video format not supported. Try transcode mode or H.264 substream.",
  "Resolusi atau codec kamera tidak kompatibel dengan profil transcode.": 
    "Camera resolution or codec incompatible with the transcoding profile.",
  "Stream kamera tidak dapat diproses. Periksa koneksi dan konfigurasi kamera.": 
    "Camera stream cannot be processed. Verify the connection and configuration.",
  "Kamera offline. Periksa koneksi jaringan dan konfigurasi kamera.":
    "Camera is offline. Check network connection and camera configuration.",
  "Stream stopped unexpectedly":
    "Stream stopped unexpectedly",
  "Spawn error":
    "Spawn error",
};

export function useTranslation() {
  const lang = useLangStore((s) => s.lang);
  const dict = translations[lang] || translations.en;

  const t = (key: TranslationKey, params?: Record<string, string | number>): string => {
    let text = dict[key] as string;
    if (!text) {
      text = translations.en[key] as string || String(key);
    }

    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        text = text.replace(new RegExp(`{${k}}`, "g"), String(v));
      });
    }

    return text;
  };

  const tError = (msg: string): string => {
    if (!msg) return "";
    if (lang === "en") {
      // 1. Check for exact match
      if (errorTranslations[msg]) {
        return errorTranslations[msg];
      }
      // 2. Check for partial match (translate known Indonesian substrings)
      let translated = msg;
      let matched = false;
      Object.entries(errorTranslations).forEach(([idStr, enStr]) => {
        if (translated.includes(idStr)) {
          translated = translated.replace(idStr, enStr);
          matched = true;
        }
      });
      if (matched) return translated;
    }
    return msg;
  };

  return { t, tError, lang };
}
export type { TranslationKey };
