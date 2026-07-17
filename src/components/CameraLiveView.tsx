import { AlertTriangle, PowerOff, Loader2 } from "lucide-react";
import { useEffect, useRef, useState, useMemo } from "react";
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
  const [fallbackMode, setFallbackMode] = useState<string | null>(null);

  useEffect(() => {
    if (onStatusChange) {
      onStatusChange(status);
    }
  }, [status, onStatusChange]);

  useEffect(() => {
    const loadGo2RTC = async () => {
      if (customElements.get("video-rtc")) {
        setScriptLoaded(true);
        return;
      }
      if (document.querySelector('script[data-go2rtc]')) {
        const waitForElement = () => {
          if (customElements.get("video-rtc")) { setScriptLoaded(true); return; }
          setTimeout(waitForElement, 100);
        };
        waitForElement();
        return;
      }
      const script = document.createElement('script');
      script.setAttribute('data-go2rtc', 'true');
      script.type = 'module';
      script.textContent = `
        import { VideoRTC } from '/video-rtc.js';
        if (!customElements.get('video-rtc')) {
          customElements.define('video-rtc', VideoRTC);
        }
        window.dispatchEvent(new Event('video-rtc-ready'));
      `;
      const onReady = () => { setScriptLoaded(true); window.removeEventListener('video-rtc-ready', onReady); };
      window.addEventListener('video-rtc-ready', onReady);
      document.head.appendChild(script);
    };
    loadGo2RTC();
  }, []);

  useEffect(() => {
    if (!scriptLoaded || !camera.enabled || !containerRef.current) return;
    
    let disposed = false;
    containerRef.current.innerHTML = "";
    setStatus("connecting");
    setErrorMsg("");

    const modes = fallbackMode || output || camera.streamType || "webrtc,mse,hls,mjpeg";
    const src = `${window.location.protocol}//${window.location.host}/api/ws?src=${encodeURIComponent(camera.id)}`;
    
    const videoRtc = document.createElement("video-rtc") as any;
    videoRtc.mode = modes;
    videoRtc.background = true;
    videoRtc.style.display = "block";
    videoRtc.style.width = "100%";
    videoRtc.style.height = "100%";

    containerRef.current.appendChild(videoRtc);
    videoRtc.addEventListener("stream-error", (e: any) => {
      if (disposed) return;
      console.warn("Go2RTC Backend Error:", e.detail);
      const msg = typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail);
      setErrorMsg(msg || "Unknown backend error");
      setStatus("error");
    });
    videoRtc.src = src;

    const attachEvents = () => {
      if (disposed) return;
      const internalVideo = videoRtc.querySelector("video");
      if (internalVideo) {
        internalVideo.controls = controls;
        internalVideo.muted = typeof muted === 'boolean' ? muted : true;
        internalVideo.addEventListener("playing", () => {
          if (!disposed) setStatus("playing");
        });
        internalVideo.addEventListener("canplay", () => {
          if (!disposed) setStatus("playing");
        });
        internalVideo.addEventListener("waiting", () => {
          if (!disposed) setStatus(prev => prev === "playing" ? "buffering" : "connecting");
        });
        internalVideo.addEventListener("stalled", () => {
          if (!disposed) setStatus("buffering");
        });
        internalVideo.addEventListener("error", () => {
          if (disposed) return;
          const err = internalVideo.error;
          if (err) {
            const isAutoSelect = !camera.streamType || camera.streamType.includes("webrtc,mse");
            if (err.code === 3 && modes !== "mjpeg" && isAutoSelect) {
              console.warn("Auto-falling back to MJPEG due to MEDIA_ERR_DECODE");
              setFallbackMode("mjpeg");
              return;
            }
            setErrorMsg(`Stream Error [${err.code}]: ${err.message || "Network or decoding failed"}`);
          }
          setStatus("error");
        });
      } else {
        setTimeout(attachEvents, 100);
      }
    };
    attachEvents();

    return () => {
      disposed = true;
      if (videoRtc && typeof videoRtc.ondisconnect === 'function') {
        videoRtc.ondisconnect();
      }
      try {
        if (containerRef.current && containerRef.current.contains(videoRtc)) {
          containerRef.current.removeChild(videoRtc);
        }
      } catch (e) {}
    };
  }, [scriptLoaded, camera.enabled, camera.id, camera.streamType, output, controls, fallbackMode]);

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

  // Poster URL: di-memoize agar tidak berganti dan berkedip saat komponen re-render (misal status berubah)
  const posterUrl = useMemo(() => {
    return `/api/streams/${camera.id}/poster?t=${Math.floor(Date.now() / 5000)}`;
  }, [camera.id]);

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
