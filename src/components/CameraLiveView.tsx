import { AlertTriangle, PowerOff } from "lucide-react";
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
}

export function CameraLiveView({ camera, output, className, controls = false, muted = true, volume = 1 }: Props) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  
  useEffect(() => {
    const loadGo2RTC = async () => {
      if (customElements.get("video-rtc")) {
        setScriptLoaded(true);
        return;
      }
      // Use a <script> tag instead of dynamic import() — more resilient
      // across reverse proxies (Cloudflare) that may strip/alter headers.
      if (document.querySelector('script[data-go2rtc]')) {
        // Script tag already added, wait for it to load
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
    
    // Clear previous video-rtc element
    containerRef.current.innerHTML = "";
    
    const modes = output || camera.streamType || "webrtc,mse,hls,mjpeg";
    
    // video-rtc.js internally converts http:// to ws:// in its src setter.
    // So we must pass an http:// URL here, NOT ws://.
    const src = `${window.location.protocol}//${window.location.host}/api/ws?src=${encodeURIComponent(camera.id)}`;
    
    // Create the video-rtc web component
    const videoRtc = document.createElement("video-rtc") as any;
    videoRtc.setAttribute("mode", modes);
    videoRtc.setAttribute("background", "true"); // autoplay muted
    videoRtc.style.display = "block";
    videoRtc.style.width = "100%";
    videoRtc.style.height = "100%";

    // IMPORTANT: Append to DOM first so connectedCallback fires,
    // then set src as a JS property (NOT attribute) because VideoRTC
    // has no observedAttributes - setAttribute('src') won't trigger the setter.
    containerRef.current.appendChild(videoRtc);
    videoRtc.src = src;

    // Disable go2rtc's built-in video controls — the app has its own overlay.
    // oninit() creates <video controls=true> internally, so we override it.
    requestAnimationFrame(() => {
      const internalVideo = videoRtc.querySelector("video");
      if (internalVideo) {
        internalVideo.controls = controls;
        internalVideo.muted = typeof muted === 'boolean' ? muted : true;
      }
    });
  }, [scriptLoaded, camera.enabled, camera.id, camera.streamType, output, controls]);

  // Sync muted and volume props dynamically
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
    <div className={cn("absolute inset-0 bg-black overflow-hidden flex items-center justify-center", className)} ref={containerRef}>
      {/* video-rtc element will be injected here */}
    </div>
  );
}
