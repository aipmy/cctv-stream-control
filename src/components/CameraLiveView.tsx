import { useEffect, useMemo, useRef, useState } from "react";
import type Hls from "hls.js";
import { AlertTriangle, Loader2, PowerOff } from "lucide-react";
import type { Camera, StreamType } from "@/types";
import { streamApi, streamUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "@/hooks/useTranslation";

interface Props {
  camera: Camera;
  output?: StreamType;
  className?: string;
  muted?: boolean;
  volume?: number;
  showErrorUrl?: boolean;
  controls?: boolean;
}

function playbackErrorMessage(t: (key: any) => string, details?: string, type?: string) {
  if (details === "bufferAppendError") {
    return t("bufferAppendError");
  }
  if (/manifest/i.test(details || "")) {
    return t("manifestError");
  }
  if (/frag/i.test(details || "")) {
    return t("fragError");
  }
  if (type === "mediaError") {
    return t("mediaError");
  }
  return t("streamDisconnectedGeneric");
}

export function CameraLiveView({ camera, output = camera.streamType, className, muted = true, volume = 1, showErrorUrl = false, controls = false }: Props) {
  const queryClient = useQueryClient();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [loading, setLoading] = useState(Boolean(camera.enabled));
  const [error, setError] = useState<string | null>(null);
  const [mjpegSrc, setMjpegSrc] = useState<string | null>(null);
  const src = useMemo(() => streamUrl(camera, output), [camera.id, output]);
  const { t } = useTranslation();

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      const v = Math.max(0, Math.min(1, volume));
      video.volume = v;
      video.muted = muted || v <= 0.02;
    }
  }, [muted, volume]);

  useEffect(() => {
    setLoading(Boolean(camera.enabled));
    setError(null);
    setMjpegSrc(null);
  }, [camera.id, camera.enabled, output]);

  useEffect(() => {
    if (!camera.enabled || output !== "MJPEG") return;
    let disposed = false;
    setLoading(true);
    setError(null);
    setMjpegSrc(null);

    async function attachMjpeg() {
      try {
        await streamApi.start(camera.id, "MJPEG");
        if (disposed) return;
        setMjpegSrc(`${src}${src.includes("?") ? "&" : "?"}r=${Date.now()}`);
        setLoading(false);
      } catch (err) {
        if (disposed) return;
        setLoading(false);
        setError(err instanceof Error ? err.message : t("mjpegFailedToOpen"));
      }
    }

    void attachMjpeg();
    return () => {
      disposed = true;
      setMjpegSrc(null);
    };
  }, [camera.id, camera.enabled, output, src, t]);

  useEffect(() => {
    if (!camera.enabled) return;
    const interval = setInterval(() => {
      void streamApi.ping(camera.id);
    }, 5000);
    return () => clearInterval(interval);
  }, [camera.enabled, camera.id]);

  useEffect(() => {
    return () => {
      void streamApi.leave(camera.id);
    };
  }, [camera.id]);

  useEffect(() => {
    if (!camera.enabled || output === "MJPEG") return;

    let disposed = false;
    let hls: Hls | null = null;
    let mediaRecoveryAttempts = 0;
    const video = videoRef.current;
    if (!video) return;

    setLoading(true);
    setError(null);
    video.pause();
    video.removeAttribute("src");
    video.load();

    // Detect Safari — only Safari should use native HLS.
    // Chrome/Edge report canPlayType support but their native demuxer
    // often fails with DEMUXER_ERROR_COULD_NOT_PARSE on live HLS streams.
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

    async function attachHls() {
      try {
        await streamApi.start(camera.id, output);
        if (disposed) return;

        // Prefer hls.js on all browsers except Safari.
        // Safari's native HLS is more reliable and supports features
        // like Low-Latency HLS natively.
        const mod = await import("hls.js");
        const HlsLib = mod.default;
        const useNative = isSafari && video.canPlayType("application/vnd.apple.mpegurl");
        const useHlsJs = !useNative && HlsLib.isSupported();

        if (useNative) {
          video.src = src;
          video.onloadeddata = () => {
            if (!disposed) setLoading(false);
          };
          video.onerror = () => {
            if (!disposed) {
              setLoading(false);
              const errMsg = video.error ? `${video.error.message} (Code: ${video.error.code})` : "";
              setError(t("streamFailedToLoadInBrowser", { output, errMsg: errMsg || t("checkCodecOrTranscode") }));
            }
          };
          video.volume = Math.max(0, Math.min(1, volume));
          video.muted = muted || video.volume <= 0.02;
          await video.play().catch(() => undefined);
          return;
        }

        if (!useHlsJs) {
          throw new Error(t("hlsNotSupported"));
        }

        hls = new HlsLib({
          lowLatencyMode: output === "HLS Low Latency",
          backBufferLength: 10,
          liveSyncDurationCount: output === "HLS Low Latency" ? 2 : 3,
          maxBufferLength: output === "HLS Low Latency" ? 8 : 16,
          manifestLoadingMaxRetry: 6,
          manifestLoadingRetryDelay: 700,
          levelLoadingMaxRetry: 6,
          fragLoadingMaxRetry: 6,
        });
        hls.loadSource(src);
        hls.attachMedia(video);
        hls.on(HlsLib.Events.MANIFEST_PARSED, () => {
          if (disposed) return;
          setLoading(false);
          video.volume = Math.max(0, Math.min(1, volume));
          video.muted = muted || video.volume <= 0.02;
          void video.play().catch(() => undefined);
        });
        hls.on(HlsLib.Events.ERROR, (_evt: unknown, data: { fatal?: boolean; details?: string; type?: string }) => {
          if (!data?.fatal || disposed) return;
          if (data.type === "mediaError") {
            if (mediaRecoveryAttempts < 1) {
              mediaRecoveryAttempts += 1;
              hls?.recoverMediaError();
              return;
            }
            if (!disposed && output !== "MJPEG") {
              // Fatal media error, probably codec issue (e.g. H.265 in copy mode).
              void streamApi.fallback(camera.id).then(() => {
                if (!disposed) {
                  void queryClient.invalidateQueries({ queryKey: ["cameras"] });
                }
              });
            }
          }
          setLoading(false);
          const base = playbackErrorMessage(t, data.details, data.type);
          void streamApi.status()
            .then((items) => {
              if (disposed) return;
              const item = items.find((x) => x.id === camera.id && x.output === output);
              setError(item?.error?.message || base);
            })
            .catch(() => setError(base));
        });
      } catch (err) {
        if (!disposed) {
          setLoading(false);
          setError(err instanceof Error ? err.message : t("streamFailedToLoad", { output }));
        }
      }
    }

    void attachHls();
    return () => {
      disposed = true;
      hls?.destroy();
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [camera.id, camera.enabled, output, src, muted, volume, queryClient, t]);

  if (!camera.enabled) {
    return (
      <div className={cn("absolute inset-0 flex flex-col items-center justify-center bg-black text-white/75", className)}>
        <PowerOff className="h-6 w-6 mb-2 text-white/50" />
        <div className="text-xs font-medium">{t("cameraDisabled")}</div>
        <div className="text-[11px] text-white/45 mt-1">{t("cameraDisabledHelp")}</div>
      </div>
    );
  }

  return (
    <div className={cn("absolute inset-0 bg-black", className)}>
      {output === "MJPEG" ? (
        mjpegSrc ? (
          <img
            key={`${camera.id}:${output}`}
            src={mjpegSrc}
            alt={`Live ${camera.name}`}
            className="absolute inset-0 h-full w-full object-contain bg-black"
            onError={() => { setLoading(false); setError(t("mjpegLoadFailedAfterReady")); }}
          />
        ) : null
      ) : (
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-contain bg-black"
          muted={muted}
          playsInline
          autoPlay
          controls={controls}
          crossOrigin="anonymous"
        />
      )}

      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black text-white/70 text-xs z-10">
          <Loader2 className="h-4 w-4 mr-2 animate-spin" /> {t("openingStream", { output })}
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4 bg-black text-white z-20">
          <AlertTriangle className="h-6 w-6 text-warning mb-2" />
          <div className="text-xs font-medium">{t("streamFailed")}</div>
          <div className="text-[11px] text-white/65 mt-1 max-w-md">{error}</div>
          {showErrorUrl && <div className="text-[10px] text-white/45 mt-2 font-mono break-all">{src}</div>}
        </div>
      )}
    </div>
  );
}
