import { AlertTriangle, PowerOff, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Camera, StreamType } from "@/types";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";

interface Props {
  camera: Camera;
  output?: StreamType;
  className?: string;
  muted?: boolean;
  volume?: number;
  showErrorUrl?: boolean;
  controls?: boolean;
  controlsVisible?: boolean;
  onStatusChange?: (status: "connecting" | "playing" | "buffering" | "error") => void;
}

export function CameraLiveView({ camera, output, className, controls = false, muted = true, volume = 1, onStatusChange }: Props) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  type PlaybackStatus = "connecting" | "playing" | "buffering" | "error";
  const [status, setStatus] = useState<PlaybackStatus>("connecting");
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    if (onStatusChange) {
      onStatusChange(status);
    }
  }, [status, onStatusChange]);

  useEffect(() => {
    if (document.querySelector('script[src="/video-rtc.js"]')) {
      setScriptLoaded(true);
      return;
    }
    const script = document.createElement("script");
    script.src = "/video-rtc.js";
    script.type = "module";
    script.onload = () => setScriptLoaded(true);
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    if (!scriptLoaded || !camera.enabled || !containerRef.current) return;
    containerRef.current.innerHTML = "";
    setStatus("connecting");
    setErrorMsg("");

    const modes = output || camera.streamType || "webrtc,mse,hls,mjpeg";
    const src = `${window.location.protocol}//${window.location.host}/api/ws?src=${encodeURIComponent(camera.id)}`;
    
    const videoRtc = document.createElement("video-rtc") as any;
    videoRtc.mode = modes;
    videoRtc.background = true;
    videoRtc.style.display = "block";
    videoRtc.style.width = "100%";
    videoRtc.style.height = "100%";

    containerRef.current.appendChild(videoRtc);
    videoRtc.addEventListener("stream-error", (e: any) => {
      console.warn("Go2RTC Backend Error:", e.detail);
      const msg = typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail);
      setErrorMsg(msg || "Unknown backend error");
      setStatus("error");
    });
    videoRtc.src = src;

    const attachEvents = () => {
      const internalVideo = videoRtc.querySelector("video");
      if (internalVideo) {
        internalVideo.controls = controls;
        internalVideo.muted = typeof muted === 'boolean' ? muted : true;
        internalVideo.addEventListener("playing", () => setStatus("playing"));
        internalVideo.addEventListener("canplay", () => setStatus("playing"));
        internalVideo.addEventListener("waiting", () => {
          setStatus(prev => prev === "playing" ? "buffering" : "connecting");
        });
        internalVideo.addEventListener("stalled", () => setStatus("buffering"));
        internalVideo.addEventListener("error", () => {
          const err = internalVideo.error;
          if (err) {
            setErrorMsg(`Stream Error [${err.code}]: ${err.message || "Network or decoding failed"}`);
          }
          setStatus("error");
        });
      } else {
        setTimeout(attachEvents, 100);
      }
    };
    attachEvents();

  }, [scriptLoaded, camera.enabled, camera.id, camera.streamType, output, controls]);

  useEffect(() => {
    if (!containerRef.current) return;
    const internalVideo = containerRef.current.querySelector("video");
    if (internalVideo) {
      if (typeof muted === 'boolean') internalVideo.muted = muted;
      if (typeof volume === 'number') internalVideo.volume = volume;
    }
  }, [muted, volume]);

  if (!camera.enabled) {
    return (
      <div className={cn("absolute inset-0 flex flex-col items-center justify-center bg-black text-white/75", className)}>
        <PowerOff className="h-6 w-6 mb-2 text-white/50" />
        <div className="text-xs font-medium">{t("cameraDisabled")}</div>
      </div>
    );
  }

  // Poster URL: pakai timestamp agar browser selalu ambil gambar baru saat reconnect
  const posterUrl = `/api/streams/${camera.id}/poster?t=${Math.floor(Date.now() / 5000)}`;

  return (
    <div
      className={cn("absolute inset-0 overflow-hidden flex items-center justify-center", className)}
      style={{
        backgroundColor: '#000',
        backgroundImage: `url(${posterUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center'
      }}
    >
      {/* Container managed purely by React for the loading/status overlay */}
      {(status === "connecting" || status === "buffering") && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/50 backdrop-blur-[1px] pointer-events-none transition-opacity duration-300">
          <Loader2 className="h-7 w-7 mb-3 animate-spin text-primary opacity-80" />
          <div className="text-xs font-semibold tracking-widest uppercase text-white/70">
            {status === "connecting" ? "Connecting" : "Buffering"}
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-none transition-opacity duration-300">
          <AlertTriangle className="h-7 w-7 mb-3 text-destructive opacity-80" />
          <div className="text-xs font-semibold tracking-widest uppercase text-destructive/90">
            Koneksi Terputus
          </div>
          <div className="text-[10px] text-muted-foreground mt-1 max-w-[90%] text-center px-4 font-mono">
            {errorMsg || "Kamera lambat merespon atau server terputus dari jaringan CCTV."}
          </div>
        </div>
      )}
      
      {/* Container managed purely by Vanilla JS for video-rtc */}
      <div ref={containerRef} className="absolute inset-0 w-full h-full" />
    </div>
  );
}
