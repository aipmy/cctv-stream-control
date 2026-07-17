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
    
    containerRef.current.innerHTML = "";
    setStatus("connecting");
    
    const modes = output || camera.streamType || "webrtc,mse,hls,mjpeg";
    const src = `${window.location.protocol}//${window.location.host}/api/ws?src=${encodeURIComponent(camera.id)}`;
    
    const videoRtc = document.createElement("video-rtc") as any;
    videoRtc.setAttribute("mode", modes);
    videoRtc.setAttribute("background", "true");
    videoRtc.style.display = "block";
    videoRtc.style.width = "100%";
    videoRtc.style.height = "100%";

    containerRef.current.appendChild(videoRtc);
    videoRtc.addEventListener("stream-error", (e: any) => {
      console.warn("Go2RTC Backend Error:", e.detail);
      setErrorMsg(e.detail);
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
        internalVideo.addEventListener("error", () => setStatus("error"));
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

  return (
    <div className={cn("absolute inset-0 bg-black overflow-hidden flex items-center justify-center", className)}>
      {/* Container managed purely by React for the loading/status overlay */}
      {(status === "connecting" || status === "buffering") && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/60 backdrop-blur-[1px] pointer-events-none transition-opacity duration-300">
          <Loader2 className="h-7 w-7 mb-3 animate-spin text-primary opacity-80" />
          <div className="text-xs font-semibold tracking-widest uppercase text-white/70">
            {status === "connecting" ? "Connecting" : "Buffering"}
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm pointer-events-none transition-opacity duration-300">
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
