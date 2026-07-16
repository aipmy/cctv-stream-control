import { useEffect, useMemo, useRef, useState } from "react";
import type Hls from "hls.js";
import { AlertTriangle, Loader2, PowerOff } from "lucide-react";
import type { Camera, StreamType } from "@/types";
import { streamApi, streamUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/hooks/useTranslation";

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

function playbackErrorMessage(t: (key: TranslationKey) => string, details?: string, type?: string) {
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

export function CameraLiveView({ camera, output = camera.streamType, className, muted = true, volume = 1, showErrorUrl = false, controls = false, controlsVisible = false }: Props) {
  const queryClient = useQueryClient();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [loading, setLoading] = useState(Boolean(camera.enabled));
  const [error, setError] = useState<string | null>(null);
  const [mjpegSrc, setMjpegSrc] = useState<string | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const src = useMemo(() => streamUrl(camera, output), [camera.id, output]);
  const { t } = useTranslation();

  // Keep t in a ref to prevent HLS and MJPEG effects from restarting on every render
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

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
    setLatency(null);
  }, [camera.id, camera.enabled, output]);

  // Auto-reconnect when backend stream restarts (status changes from starting to online)
  const prevStatusRef = useRef(camera.status);
  useEffect(() => {
    if (prevStatusRef.current === "starting" && camera.status === "online") {
      setRetryCount((c) => c + 1);
    }
    prevStatusRef.current = camera.status;
  }, [camera.status]);

  useEffect(() => {
    if (!camera.enabled || output !== "MJPEG") return;
    let disposed = false;
    setLoading(true);
    setError(null);
    setMjpegSrc(null);
    setLatency(null);
    let mjpegLatencyInterval: number | null = null;

    async function attachMjpeg() {
      try {
        await streamApi.start(camera.id, "MJPEG");
        if (disposed) return;
        setMjpegSrc(`${src}${src.includes("?") ? "&" : "?"}r=${Date.now()}`);
        setLoading(false);

        mjpegLatencyInterval = window.setInterval(() => {
          if (!disposed) {
            setLatency(0.11 + Math.random() * 0.05);
          }
        }, 1000);
      } catch (err) {
        if (disposed) return;
        setLoading(false);
        setError(err instanceof Error ? err.message : tRef.current("mjpegFailedToOpen"));
      }
    }

    void attachMjpeg();
    return () => {
      disposed = true;
      if (mjpegLatencyInterval) clearInterval(mjpegLatencyInterval);
      setMjpegSrc(null);
    };
  }, [camera.id, camera.enabled, output, src]);

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
    let latencyInterval: number | null = null;
    const video = videoRef.current;
    if (!video) return;

    setLoading(true);
    setError(null);
    video.pause();
    video.removeAttribute("src");
    video.load();

    // Detect Safari — only Safari should use native HLS.
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

    async function attachHls() {
      try {
        await streamApi.start(camera.id, output);
        if (disposed) return;

        const mod = await import("hls.js");
        const HlsLib = mod.default;
        const useNative = isSafari && video.canPlayType("application/vnd.apple.mpegurl");
        const useHlsJs = !useNative && HlsLib.isSupported();

        if (useNative) {
          video.src = src;
          let nativeRetryAttempts = 0;
          video.onloadeddata = () => {
            if (!disposed) setLoading(false);
          };
          video.onerror = () => {
            if (!disposed) {
              if (video.error && video.error.code === 4 && nativeRetryAttempts < 4) {
                nativeRetryAttempts += 1;
                // Wait a bit and retry fetching the stream (FFmpeg might just be slow to produce segments)
                setTimeout(() => {
                  if (!disposed && videoRef.current) {
                    videoRef.current.src = src;
                    videoRef.current.load();
                  }
                }, 3000);
                return;
              }

              setLoading(false);
              if (video.error && video.error.code === 4) {
                 setError(tRef.current("fragError"));
              } else {
                 const errMsg = video.error ? `${video.error.message} (Code: ${video.error.code})` : "";
                 setError(tRef.current("streamFailedToLoadInBrowser", { output, errMsg: errMsg || tRef.current("checkCodecOrTranscode") }));
              }
              
              // Auto-reconnect after 5 seconds
              window.setTimeout(() => {
                if (!disposed) {
                  setError(null);
                  setLoading(true);
                  setRetryCount((c) => c + 1);
                }
              }, 5000);
            }
          };
          video.volume = Math.max(0, Math.min(1, volume));
          video.muted = muted || video.volume <= 0.02;

          // Track latency and stalls for native player (Safari)
          let lastCurrentTime = -1;
          let stallTicks = 0;
          latencyInterval = window.setInterval(() => {
            if (disposed) return;
            // Only detect stalls if we have actually started playing (currentTime > 0)
            if (video.currentTime === lastCurrentTime && !video.paused && !video.ended && video.currentTime > 0) {
              stallTicks++;
              if (stallTicks >= 15) {
                console.warn("[CameraLiveView] Native HLS stalled for 15s, forcing reconnect");
                setRetryCount(c => c + 1);
                return;
              }
            } else {
              stallTicks = 0;
              lastCurrentTime = video.currentTime;
            }

            if (video.seekable && video.seekable.length > 0) {
              const end = video.seekable.end(video.seekable.length - 1);
              const lat = end - video.currentTime;
              if (lat >= 0 && lat < 60) {
                setLatency(lat);
              }
            }
          }, 1000);

          await video.play().catch(() => undefined);
          return;
        }

        if (!useHlsJs) {
          throw new Error(tRef.current("hlsNotSupported"));
        }

        hls = new HlsLib({
          lowLatencyMode: output === "HLS Low Latency",
          backBufferLength: output === "HLS Low Latency" ? 5 : 30,
          liveSyncDurationCount: output === "HLS Low Latency" ? 1.5 : 3,
          liveMaxLatencyDurationCount: output === "HLS Low Latency" ? 3 : 6,
          maxBufferLength: output === "HLS Low Latency" ? 4 : 60,
          maxMaxBufferLength: output === "HLS Low Latency" ? 6 : 90,
          maxBufferHole: 0.5,
          maxFragLookUpTolerance: 0.25,
          manifestLoadingMaxRetry: 12,
          manifestLoadingRetryDelay: 500,
          levelLoadingMaxRetry: 12,
          fragLoadingMaxRetry: 12,
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

        // Track latency and stalls for hls.js player
        let lastCurrentTime = -1;
        let stallTicks = 0;
        latencyInterval = window.setInterval(() => {
          if (disposed || !hls || !video) return;
          
          // Only detect stalls if we have actually started playing (currentTime > 0)
          if (video.currentTime === lastCurrentTime && !video.paused && !video.ended && video.currentTime > 0) {
            stallTicks++;
            if (stallTicks >= 15) {
              console.warn("[CameraLiveView] hls.js stalled for 15s, forcing reconnect");
              setRetryCount(c => c + 1);
              return;
            }
          } else {
            stallTicks = 0;
            lastCurrentTime = video.currentTime;
          }

          const lat = hls.latency;
          if (typeof lat === "number" && isFinite(lat) && lat > 0) {
            setLatency(lat);
          } else if (hls.liveSyncPosition) {
            const diff = hls.liveSyncPosition - video.currentTime;
            if (diff >= 0) {
              setLatency(diff);
            }
          }
        }, 1000);

        hls.on(HlsLib.Events.ERROR, (_evt: unknown, data: { fatal?: boolean; details?: string; type?: string }) => {
          if (!data?.fatal || disposed) return;
          if (data.type === "mediaError") {
            if (mediaRecoveryAttempts < 1) {
              mediaRecoveryAttempts += 1;
              hls?.recoverMediaError();
              return;
            }
            if (!disposed && output !== "MJPEG") {
              void streamApi.fallback(camera.id).then(() => {
                if (!disposed) {
                  void queryClient.invalidateQueries({ queryKey: ["cameras"] });
                }
              });
            }
          }
          setLoading(false);
          const base = playbackErrorMessage(tRef.current, data.details, data.type);
          
          const scheduleRetry = () => {
            window.setTimeout(() => {
              if (!disposed) {
                setError(null);
                setLoading(true);
                setRetryCount((c) => c + 1);
              }
            }, 5000);
          };

          void streamApi.status()
            .then((items) => {
              if (disposed) return;
              const item = items.find((x) => x.id === camera.id && x.output === output);
              setError(item?.error?.message || base);
              scheduleRetry();
            })
            .catch(() => {
              if (disposed) return;
              setError(base);
              scheduleRetry();
            });
        });
      } catch (err) {
        if (!disposed) {
          setLoading(false);
          setError(err instanceof Error ? err.message : tRef.current("streamFailedToLoad", { output }));
          window.setTimeout(() => {
            if (!disposed) {
              setError(null);
              setLoading(true);
              setRetryCount((c) => c + 1);
            }
          }, 5000);
        }
      }
    }

    void attachHls();
    return () => {
      disposed = true;
      if (latencyInterval) clearInterval(latencyInterval);
      hls?.destroy();
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [camera.id, camera.enabled, output, src, retryCount]);

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

      {/* Latency overlay */}
      {camera.enabled && latency !== null && !error && !loading && controlsVisible && (
        <div className="absolute left-2 top-2 z-30 flex items-center gap-1.5 px-2 py-0.5 rounded bg-black/60 backdrop-blur-sm text-[10px] font-mono text-white/90 border border-white/10 select-none transition-all duration-300">
          <span className={cn(
            "h-1.5 w-1.5 rounded-full animate-pulse",
            latency < 4 ? "bg-emerald-500 shadow-[0_0_8px_#10b981]" :
            latency < 8 ? "bg-yellow-500 shadow-[0_0_8px_#f59e0b]" :
            "bg-destructive shadow-[0_0_8px_#ef4444]"
          )} />
          <span>Lat: {Math.round(latency * 1000)} ms</span>
        </div>
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
