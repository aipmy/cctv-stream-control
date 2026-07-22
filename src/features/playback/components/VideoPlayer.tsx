import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { usePlaybackStore } from "../store/usePlaybackStore";
import { useShallow } from "zustand/react/shallow";
import { playbackUrl } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlayCircle, Loader2, AlertTriangle, Play, Pause, RotateCcw, RotateCw, Volume2, VolumeX, Maximize, Download } from "lucide-react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";

export function VideoPlayer() {
  const { t } = useTranslation();
  const location = useLocation();
  const effectiveState = location.state as { cameraId?: string; date?: string; eventSeek?: boolean; timestamp?: number } | null;

  const {
    selectedCameraId, selectedDate, playbackWindowMinutes, playbackWindowCenterTs,
    playbackInfo, loading, error, setError,
    isPlaying, setIsPlaying,
    isMuted, setIsMuted,
    volume, setVolume,
    playbackSpeed, setPlaybackSpeed,
    activePosterUrl, setActivePosterUrl,
    setCurrentPlaybackTs, setCurrentRecordingTime,
    setTimelineCenterTs,
    jumpToTimeTrigger, setJumpToTimeTrigger,
    pendingSeekTs, setPendingSeekTs,
    loadPlaybackTrigger, setLoadPlaybackTrigger,
    setIsDownloadFormOpen
  } = usePlaybackStore(useShallow(s => ({
    selectedCameraId: s.selectedCameraId, selectedDate: s.selectedDate, playbackWindowMinutes: s.playbackWindowMinutes, playbackWindowCenterTs: s.playbackWindowCenterTs,
    playbackInfo: s.playbackInfo, loading: s.loading, error: s.error, setError: s.setError,
    isPlaying: s.isPlaying, setIsPlaying: s.setIsPlaying,
    isMuted: s.isMuted, setIsMuted: s.setIsMuted,
    volume: s.volume, setVolume: s.setVolume,
    playbackSpeed: s.playbackSpeed, setPlaybackSpeed: s.setPlaybackSpeed,
    activePosterUrl: s.activePosterUrl, setActivePosterUrl: s.setActivePosterUrl,
    setCurrentPlaybackTs: s.setCurrentPlaybackTs, setCurrentRecordingTime: s.setCurrentRecordingTime,
    setTimelineCenterTs: s.setTimelineCenterTs,
    jumpToTimeTrigger: s.jumpToTimeTrigger, setJumpToTimeTrigger: s.setJumpToTimeTrigger,
    pendingSeekTs: s.pendingSeekTs, setPendingSeekTs: s.setPendingSeekTs,
    loadPlaybackTrigger: s.loadPlaybackTrigger, setLoadPlaybackTrigger: s.setLoadPlaybackTrigger,
    setIsDownloadFormOpen: s.setIsDownloadFormOpen
  })));

  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<any | null>(null);
  const initialSeekDone = useRef(false);
  const [isBuffering, setIsBuffering] = useState(false);

  // Synchronize URL query changes to reset seek ref
  useEffect(() => {
    if (effectiveState && effectiveState.eventSeek) {
      initialSeekDone.current = false;
    }
  }, [effectiveState, selectedCameraId]);

  // Handle HLS initialization
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playbackInfo || !playbackInfo.hasRecording) return;

    let disposed = false;
    let start: number | undefined;
    let end: number | undefined;

    if (playbackWindowMinutes !== "none" && playbackWindowCenterTs !== null) {
      const halfWindow = (parseInt(playbackWindowMinutes, 10) * 60) / 2;
      start = playbackWindowCenterTs - halfWindow;
      end = playbackWindowCenterTs + halfWindow;
    }

    const playlistSrc = playbackUrl(selectedCameraId, selectedDate, start, end);
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    const useNative = isSafari && video.canPlayType("application/vnd.apple.mpegurl");

    async function initializePlayer() {
      if (useNative) {
        video.src = playlistSrc;
        let nativeRetryAttempts = 0;
        video.onloadedmetadata = () => {
          if (!disposed) {
            video.muted = isMuted;
            if (pendingSeekTs !== null) {
              seekToTimestamp(pendingSeekTs);
              setPendingSeekTs(null);
            } else if (effectiveState?.eventSeek && effectiveState?.timestamp && !initialSeekDone.current) {
              seekToTimestamp(effectiveState.timestamp);
              initialSeekDone.current = true;
            }
            video.play().catch(() => {});
            setIsPlaying(true);
          }
        };
        video.onerror = () => {
          if (!disposed) {
            if (video.error && video.error.code === 4 && nativeRetryAttempts < 4) {
              nativeRetryAttempts += 1;
              setTimeout(() => {
                if (!disposed && videoRef.current) {
                  videoRef.current.src = playlistSrc;
                  videoRef.current.load();
                }
              }, 3000);
              return;
            }
            
            // If it still fails, show error overlay
            if (video.error && video.error.code === 4) {
               setError(t("failedLoadSegments")); // or a translation for code 4
               setActivePosterUrl(null);
            } else {
               setError(t("failedLoadSegments"));
               setActivePosterUrl(null);
            }
          }
        };
        return;
      }

      try {
        const mod = await import("hls.js");
        const Hls = mod.default;
        if (!Hls.isSupported()) return;

        const hls = new Hls({
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          backBufferLength: 30,
          enableWorker: true,
          manifestLoadingMaxRetry: 6,
          manifestLoadingRetryDelay: 1000,
        });
        hlsRef.current = hls;

        hls.loadSource(playlistSrc);
        hls.attachMedia(video);
        
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (!disposed) {
            video.muted = isMuted;
            if (pendingSeekTs !== null) {
              seekToTimestamp(pendingSeekTs);
              setPendingSeekTs(null);
            } else if (effectiveState?.eventSeek && effectiveState?.timestamp && !initialSeekDone.current) {
              seekToTimestamp(effectiveState.timestamp);
              initialSeekDone.current = true;
            }
            video.play().catch(() => {});
            setIsPlaying(true);
          }
        });

        let mediaRecoveryAttempts = 0;
        let lastRecoveryTime = 0;
        hls.on(Hls.Events.ERROR, (_evt, data) => {
          if (data.fatal) {
            if (data.type === "mediaError") {
              const now = Date.now();
              if (now - lastRecoveryTime > 3000) {
                mediaRecoveryAttempts = 0;
              }
              lastRecoveryTime = now;

              if (mediaRecoveryAttempts < 5) {
                mediaRecoveryAttempts += 1;
                hls.recoverMediaError();
              } else {
                setError(t("mediaRecoveryFailed"));
              }
            } else if (data.type === "networkError") {
              hls.startLoad();
            } else {
              hls.destroy();
              setError(t("failedLoadSegments"));
            }
          }
        });
      } catch (err) {
        console.error("Failed to load Hls.js", err);
      }
    }

    initializePlayer();

    return () => {
      disposed = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [playbackInfo?.hasRecording, selectedCameraId, selectedDate, playbackWindowMinutes, playbackWindowCenterTs, loadPlaybackTrigger]);

  // Synchronize playback speed
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = playbackSpeed;
    const handleRateChange = () => {
      if (video.playbackRate !== playbackSpeed) {
        video.playbackRate = playbackSpeed;
      }
    };
    video.addEventListener("ratechange", handleRateChange);
    return () => video.removeEventListener("ratechange", handleRateChange);
  }, [playbackSpeed, playbackInfo]);

  // Handle manual jump triggers from context
  useEffect(() => {
    if (jumpToTimeTrigger !== null) {
      seekToTimestamp(jumpToTimeTrigger);
      setTimelineCenterTs(null); // Reset to null so it auto-follows currentPlaybackTs
      setJumpToTimeTrigger(null); // consume trigger
    }
  }, [jumpToTimeTrigger]);

  const seekToTimestamp = (targetTs: number) => {
    const video = videoRef.current;
    if (!video || !playbackInfo || !playbackInfo.firstSegmentUnixTime) return;

    let offset = 0;
    const mappings = playbackInfo.segmentMappings || [];
    
    if (mappings.length > 0) {
      // Find the block that contains the target timestamp
      let found = mappings.find((m: any) => targetTs >= m.ts && targetTs < m.ts + m.duration);
      
      if (found) {
        // Target is inside a recorded segment
        offset = found.offset + Math.max(0, targetTs - found.ts);
      } else {
        const after = mappings.filter((m: any) => m.ts > targetTs);
        if (after.length > 0) {
          offset = after[0].offset; // Seek to start of next available segment
          const gapTimeStr = new Date(targetTs * 1000).toLocaleTimeString("id-ID", { hour12: false });
          const nextTimeStr = new Date(after[0].ts * 1000).toLocaleTimeString("id-ID", { hour12: false });
          toast.info(`Jeda rekaman di ${gapTimeStr}. Melompat ke rekaman berikutnya (${nextTimeStr})`);
        } else {
          // No segments exist AFTER targetTs. Check if targetTs is close to the latest available segment
          const last = mappings[mappings.length - 1];
          const lastEnd = last.ts + last.duration;
          
          if (targetTs <= lastEnd + 90) {
            // Target is for a very recent event whose segment was just written or is completing
            offset = last.offset + Math.max(0, Math.min(last.duration - 1, targetTs - last.ts));
          } else {
            // Target is far beyond available recordings
            offset = last.offset + Math.max(0, last.duration - 1);
            toast.info("Rekaman belum tersedia untuk waktu ini. Menampilkan rekaman terbaru.");
          }
        }
      }
    } else {
      offset = targetTs - playbackInfo.firstSegmentUnixTime;
    }

    video.currentTime = Math.max(0, offset);
    video.play().catch(() => {});
    setIsPlaying(true);
  };

  const handleVideoTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || !playbackInfo || !playbackInfo.segmentMappings || playbackInfo.segmentMappings.length === 0) return;

    const currentTime = video.currentTime;
    const mappings = playbackInfo.segmentMappings;
    
    // Find the block that contains the current video offset
    let block = mappings.find((m: any) => currentTime >= m.offset && currentTime < m.offset + m.duration);
    
    if (!block) {
      // Fall back: find the last block whose offset is <= currentTime
      const before = mappings.filter((m: any) => m.offset <= currentTime);
      block = before.length > 0 ? before[before.length - 1] : mappings[0];
    }

    if (block) {
      const ts = block.ts + (currentTime - block.offset);
      const formattedTime = new Date(ts * 1000).toLocaleTimeString("id-ID", { hour12: false });
      setCurrentPlaybackTs(Math.floor(ts));
      setCurrentRecordingTime(formattedTime);
      setPreciseTimeInput(new Date(ts * 1000).toLocaleTimeString("sv-SE"));
    }
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    video.muted = nextMuted;
  };

  const handleVolumeChange = (newVal: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = newVal;
    setVolume(newVal);
    if (newVal > 0 && isMuted) {
      setIsMuted(false);
      video.muted = false;
    } else if (newVal === 0 && !isMuted) {
      setIsMuted(true);
      video.muted = true;
    }
  };

  const handleTimeShift = (seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime + seconds);
    }
  };

  const toggleFullscreen = () => {
    if (playerContainerRef.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else {
        playerContainerRef.current.requestFullscreen().catch(() => {});
      }
    }
  };

  return (
    <>
      <div className="w-full h-full flex flex-col gap-2">
        <Card 
          ref={playerContainerRef} 
          className="w-full h-full max-h-full overflow-hidden bg-black relative flex flex-col items-center justify-center border-none rounded-xl"
        >
          {loading && !activePosterUrl && (
            <div className="absolute top-4 right-4 flex items-center gap-2 bg-slate-950/80 backdrop-blur-md border border-white/10 px-2.5 py-1.5 rounded-full text-white text-[10px] font-medium z-25 shadow-lg animate-fade-in">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              <span>{t("loadingSegments")}...</span>
            </div>
          )}

          {!selectedCameraId ? (
            <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground flex-1">
              <PlayCircle className="h-12 w-12 text-primary/45 mb-3 animate-pulse" />
              <h3 className="font-semibold text-sm text-white/85">{t("pleaseSelectCamera")}</h3>
              <p className="text-xs text-white/45 max-w-xs mt-1">
                {t("selectCameraPlaybackHelp")}
              </p>
            </div>
          ) : playbackInfo?.hasRecording ? (
            <div className="relative w-full h-full flex items-center justify-center min-h-0">
              <video
                ref={videoRef}
                className="w-full h-full object-contain cursor-pointer"
                crossOrigin="anonymous"
                muted={isMuted}
                playsInline
                onTimeUpdate={handleVideoTimeUpdate}
                onWaiting={() => {
                  const v = videoRef.current;
                  if (v && !v.paused) {
                    setIsBuffering(true);
                  }
                }}
                onPlaying={() => {
                  setIsBuffering(false);
                  setActivePosterUrl(null);
                }}
                onSeeked={() => {
                  setActivePosterUrl(null);
                }}
                onPause={() => {
                  setIsPlaying(false);
                  setIsBuffering(false);
                }}
                onPlay={() => setIsPlaying(true)}
                onClick={togglePlay}
              />
              {activePosterUrl && (
                <div className="absolute inset-0 bg-slate-950 flex items-center justify-center z-10 pointer-events-none">
                  <img
                    src={activePosterUrl}
                    alt="Event Snapshot"
                    className="w-full h-full object-contain select-none animate-fade-in"
                  />
                  <div className="absolute inset-0 bg-black/25" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="bg-black/75 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 flex items-center gap-2 text-white text-xs font-semibold shadow-2xl">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      <span>{t("loadingSegments")}...</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground flex-1">
              <PlayCircle className="h-12 w-12 text-muted-foreground/30 mb-3" />
              <h3 className="font-semibold text-sm text-white/85">{t("noVideo")}</h3>
              <p className="text-xs text-white/45 max-w-xs mt-1">
                {t("cameraOfflineOrNoRecordingsHelp").replace("{date}", selectedDate)}
              </p>
            </div>
          )}

          {isBuffering && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 z-20 pointer-events-none">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-4 bg-slate-950 text-center text-white z-20 gap-3">
              <AlertTriangle className="h-7 w-7 text-destructive" />
              <div className="space-y-1">
                <div className="text-xs font-semibold">{t("streamFailed")}</div>
                <div className="text-[11px] text-white/60 max-w-md mb-2">{error}</div>
                <Button 
                  size="sm" 
                  variant="secondary" 
                  onClick={() => {
                    setError(null);
                    setLoadPlaybackTrigger((prev) => prev + 1);
                  }}
                >
                  {t("retry") || "Retry"}
                </Button>
              </div>
            </div>
          )}
        </Card>

        {playbackInfo?.hasRecording && (
          <div className="w-full bg-slate-950/90 border border-white/10 p-1.5 sm:p-2 flex items-center justify-between flex-nowrap overflow-x-auto scrollbar-hide gap-2 shrink-0 rounded-b-xl z-20 relative">
            <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 text-white hover:bg-white/10 hover:text-white rounded-lg transition-colors shrink-0"
                onClick={togglePlay}
              >
                {isPlaying ? <Pause className="h-4.5 w-4.5" /> : <Play className="h-4.5 w-4.5 text-primary-foreground fill-white" />}
              </Button>
              
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 text-white hover:bg-white/10 hover:text-white rounded-lg transition-colors shrink-0"
                onClick={() => handleTimeShift(-10)}
                title={t("rewind10s")}
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
              
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 text-white hover:bg-white/10 hover:text-white rounded-lg transition-colors shrink-0"
                onClick={() => handleTimeShift(10)}
                title={t("forward10s")}
              >
                <RotateCw className="h-4 w-4" />
              </Button>

              <div className="flex items-center gap-1.5 ml-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0 text-white hover:bg-white/10 hover:text-white rounded-lg transition-colors shrink-0"
                  onClick={toggleMute}
                >
                  {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </Button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={volume}
                  onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                  className="hidden sm:block w-16 md:w-20 h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-primary transition-all duration-200"
                />
              </div>
            </div>

            <div className="flex items-center gap-1 sm:gap-2 shrink-0 ml-auto">
              <div className="flex items-center gap-1.5 text-white text-xs font-semibold bg-white/5 rounded-lg px-2 py-0.5 border border-white/5">
                <span className="text-[9px] text-slate-400 uppercase tracking-wider">{t("speed")}</span>
                <Select
                  value={String(playbackSpeed)}
                  onValueChange={(val) => setPlaybackSpeed(parseFloat(val))}
                >
                  <SelectTrigger className="w-[60px] h-6 bg-transparent hover:bg-white/5 border-none text-white text-xs px-1 py-0 shadow-none transition-colors focus:ring-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border border-white/10 text-white min-w-[80px]">
                    <SelectItem value="0.5" className="hover:bg-white/5 focus:bg-white/5 text-xs py-1">0.5x</SelectItem>
                    <SelectItem value="1" className="hover:bg-white/5 focus:bg-white/5 text-xs py-1">1x Normal</SelectItem>
                    <SelectItem value="2" className="hover:bg-white/5 focus:bg-white/5 text-xs py-1">2x</SelectItem>
                    <SelectItem value="4" className="hover:bg-white/5 focus:bg-white/5 text-xs py-1">4x</SelectItem>
                    <SelectItem value="8" className="hover:bg-white/5 focus:bg-white/5 text-xs py-1">8x</SelectItem>
                    <SelectItem value="16" className="hover:bg-white/5 focus:bg-white/5 text-xs py-1">16x</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 text-white hover:bg-white/10 hover:text-white rounded-lg transition-colors shrink-0"
                onClick={() => setIsDownloadFormOpen(true)}
                title={t("downloadClip")}
              >
                <Download className="h-4 w-4" />
              </Button>

              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 text-white hover:bg-white/10 hover:text-white rounded-lg transition-colors shrink-0"
                onClick={toggleFullscreen}
              >
                <Maximize className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
