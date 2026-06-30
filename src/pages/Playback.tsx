import { useState, useEffect, useRef, useMemo } from "react";
import { useLocation } from "react-router-dom";
import type Hls from "hls.js";
import { useTranslation } from "@/hooks/useTranslation";
import { useCamerasQuery } from "@/features/cameras/queries";
import { eventApi, streamApi, playbackUrl, downloadUrl, getApiToken, API_BASE } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { toast } from "sonner";
import { 
  PlayCircle, Calendar, Download, Eye, ShieldAlert, AlertTriangle, Loader2, 
  User, Footprints, Activity, Trash2, Play, Pause, RotateCcw, RotateCw, 
  Volume2, VolumeX, Maximize, Search, SlidersHorizontal, Info, ChevronsUpDown
} from "lucide-react";
import type { SmartEvent } from "@/types";
import { cn } from "@/lib/utils";

const getClassificationBadge = (classification?: string, t?: any) => {
  switch (classification) {
    case "human":
      return {
        icon: <User className="h-3 w-3 text-red-500" />,
        label: t ? t("humanBadge") : "Manusia",
        bgColor: "bg-red-500/10 border-red-500/20 text-red-500"
      };
    case "pet":
      return {
        icon: <Footprints className="h-3 w-3 text-amber-500" />,
        label: t ? t("petBadge") : "Hewan/Objek",
        bgColor: "bg-amber-500/10 border-amber-500/20 text-amber-500"
      };
    case "pixel":
      return {
        icon: <Activity className="h-3 w-3 text-primary" />,
        label: t ? t("pixelBadge") : "Perubahan Gambar",
        bgColor: "bg-primary/10 border-primary/20 text-primary"
      };
    default:
      return {
        icon: <Activity className="h-3 w-3 text-primary" />,
        label: t ? t("motionBadge") : "Gerakan",
        bgColor: "bg-primary/10 border-primary/20 text-primary"
      };
  }
};

const getClassificationLabel = (classification?: string, fallback?: string, t?: any) => {
  switch (classification) {
    case "human":
      return t ? t("humanLabel") : "Deteksi Manusia";
    case "pet":
      return t ? t("petLabel") : "Deteksi Hewan";
    case "pixel":
      return t ? t("pixelLabel") : "Perubahan Gambar";
    default:
      return fallback || (t ? t("motionLabel") : "Deteksi Gerakan");
  }
};

export default function Playback() {
  const { t } = useTranslation();
  
  const formatBytes = (bytes?: number) => {
    if (bytes === undefined || bytes === null || isNaN(bytes)) return "0 B";
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const { data: camerasData } = useCamerasQuery();
  const cameras = (camerasData || []).filter(c => c.enabled);

  const location = useLocation();
  const stateVal = location.state as { cameraId?: string; date?: string; timestamp?: number; eventSeek?: boolean } | null;
  const initialSeekDone = useRef(false);
  const dragStartPlayheadRef = useRef<number | null>(null);

  const [selectedCameraId, setSelectedCameraId] = useState(() => stateVal?.cameraId || "");
  const [cameraSearchQuery, setCameraSearchQuery] = useState("");
  const [isCameraPopoverOpen, setIsCameraPopoverOpen] = useState(false);

  const filteredCameras = useMemo(() => {
    if (!cameraSearchQuery) return cameras;
    const q = cameraSearchQuery.toLowerCase();
    return cameras.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.site || "").toLowerCase().includes(q) ||
        (c.ip || "").toLowerCase().includes(q) ||
        (c.brand || "").toLowerCase().includes(q)
    );
  }, [cameras, cameraSearchQuery]);

  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [selectedDate, setSelectedDate] = useState(() => {
    if (stateVal?.date) return stateVal.date;
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  });

  // Controls UI state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [volume, setVolume] = useState(1);
  const [isBuffering, setIsBuffering] = useState(false);

  // Playback window & center states
  const [playbackWindowMinutes, setPlaybackWindowMinutes] = useState<string>(() => stateVal?.eventSeek ? "15" : "none");
  const [playbackWindowCenterTs, setPlaybackWindowCenterTs] = useState<number | null>(() => stateVal?.eventSeek ? stateVal.timestamp || null : null);

  const [playbackInfo, setPlaybackInfo] = useState<{
    hasRecording: boolean;
    hlsUrl?: string;
    firstSegmentUnixTime?: number;
    lastSegmentUnixTime?: number;
    segmentMappings?: Array<{ ts: number; offset: number; duration: number }>;
    diskUsageBytes?: number;
  } | null>(null);

  const [events, setEvents] = useState<SmartEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Download form states
  const [downloadStart, setDownloadStart] = useState("12:00");
  const [downloadEnd, setDownloadEnd] = useState("12:05");

  // Search & Filters sidebar state
  const [searchKeyword, setSearchKeyword] = useState("");
  const [minScore, setMinScore] = useState(0);
  const [filterStartTime, setFilterStartTime] = useState("00:00");
  const [filterEndTime, setFilterEndTime] = useState("23:59");
  const [deleteEventTarget, setDeleteEventTarget] = useState<SmartEvent | null>(null);

  // Timeline visual states & clock
  const [timelineZoom, setTimelineZoom] = useState<"24h" | "6h" | "1h" | "15m" | "5m" | "1m">("24h");
  const [currentPlaybackTs, setCurrentPlaybackTs] = useState<number | null>(null);
  const [currentRecordingTime, setCurrentRecordingTime] = useState<string | null>(null);
  const [preciseTimeInput, setPreciseTimeInput] = useState("12:00:00");
  
  // Interactive drag / pan timeline state
  const [timelineCenterTs, setTimelineCenterTs] = useState<number | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartCenter, setDragStartCenter] = useState<number | null>(null);

  // Tooltip hover state
  const [hoverInfo, setHoverInfo] = useState<{
    x: number;
    time: number;
    show: boolean;
  }>({ x: 0, time: 0, show: false });

  // Refs
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const autoSeekEventTsRef = useRef<string | null>(null);

  // Download Preview States and Refs
  const [isPreviewDownloadOpen, setIsPreviewDownloadOpen] = useState(false);
  const [previewStartTs, setPreviewStartTs] = useState<number | null>(null);
  const [previewEndTs, setPreviewEndTs] = useState<number | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewHlsRef = useRef<any | null>(null);

  useEffect(() => {
    const video = previewVideoRef.current;
    if (!video || !isPreviewDownloadOpen || !previewStartTs || !previewEndTs || !selectedCameraId) return;

    let disposed = false;
    const previewSrc = playbackUrl(selectedCameraId, selectedDate, previewStartTs, previewEndTs);

    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    const useNative = isSafari && video.canPlayType("application/vnd.apple.mpegurl");

    async function initPreview() {
      if (useNative) {
        video.src = previewSrc;
        video.onloadedmetadata = () => {
          if (!disposed) {
            video.play().catch(() => {});
          }
        };
        return;
      }

      try {
        const mod = await import("hls.js");
        const Hls = mod.default;
        if (!Hls.isSupported()) return;

        const hls = new Hls({
          maxBufferLength: 10,
        });
        previewHlsRef.current = hls;
        hls.loadSource(previewSrc);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (!disposed) {
            video.play().catch(() => {});
          }
        });
      } catch (err) {
        console.error("Failed to load Hls.js for preview", err);
      }
    }

    initPreview();

    return () => {
      disposed = true;
      if (previewHlsRef.current) {
        previewHlsRef.current.destroy();
        previewHlsRef.current = null;
      }
    };
  }, [isPreviewDownloadOpen, previewStartTs, previewEndTs, selectedCameraId, selectedDate]);

  // 1. Fetch playback info and events
  const loadPlaybackData = async () => {
    if (!selectedCameraId) return;
    setLoading(true);
    setError(null);
    setPlaybackInfo(null);
    setCurrentPlaybackTs(null);
    setCurrentRecordingTime(null);
    setTimelineCenterTs(null);

    // Destroy HLS
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.removeAttribute("src");
      videoRef.current.load();
    }

    try {
      let start: number | undefined;
      let end: number | undefined;

      if (playbackWindowMinutes !== "none" && playbackWindowCenterTs !== null) {
        const halfWindow = (parseInt(playbackWindowMinutes, 10) * 60) / 2;
        start = playbackWindowCenterTs - halfWindow;
        end = playbackWindowCenterTs + halfWindow;
      }

      // Fetch playback segments metadata
      const info = await streamApi.playbackInfo(selectedCameraId, selectedDate, start, end);
      setPlaybackInfo(info);

      if (info.hasRecording) {
        let startTs = info.firstSegmentUnixTime;
        if (stateVal?.eventSeek && stateVal?.timestamp && !initialSeekDone.current) {
          startTs = stateVal.timestamp;
        }
        if (startTs) {
          setCurrentPlaybackTs(startTs);
          setCurrentRecordingTime(new Date(startTs * 1000).toLocaleTimeString("id-ID", { hour12: false }));
        }

        // Fetch motion events
        const allEvents = await eventApi.list();
        const filtered = allEvents.filter((e) => {
          const eventLocalDate = new Date(e.ts).toLocaleDateString("sv-SE");
          return (
            e.cameraId === selectedCameraId &&
            e.type === "motion" &&
            eventLocalDate === selectedDate
          );
        });
        filtered.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
        setEvents(filtered);

        if (autoSeekEventTsRef.current) {
          const targetTs = autoSeekEventTsRef.current;
          autoSeekEventTsRef.current = null;
          setTimeout(() => {
            seekToEventDirect(targetTs, info);
          }, 800);
        }
      } else {
        setEvents([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedLoadRecordings"));
      toast.error(t("failedFetchPlayback"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPlaybackData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCameraId, selectedDate, playbackWindowMinutes, playbackWindowCenterTs]);

  useEffect(() => {
    if (!selectedCameraId) {
      setLoading(true);
      eventApi.list()
        .then((allEvents) => {
          const filtered = allEvents.filter((e) => e.type === "motion");
          filtered.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
          setEvents(filtered);
        })
        .catch((err) => {
          console.error("Failed to load global events", err);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [selectedCameraId]);

  // 2. Attach Hls.js to custom video element
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
        video.onloadedmetadata = () => {
          if (!disposed) {
            video.muted = isMuted;
            if (stateVal?.eventSeek && stateVal?.timestamp && !initialSeekDone.current) {
              const targetTs = stateVal.timestamp;
              let offset = 0;
              const mappings = playbackInfo.segmentMappings || [];
              if (mappings.length > 0) {
                const closest = mappings.reduce((prev, curr) => {
                  return Math.abs(curr.ts - targetTs) < Math.abs(prev.ts - targetTs) ? curr : prev;
                });
                offset = closest.offset + Math.max(0, targetTs - closest.ts);
              } else if (playbackInfo.firstSegmentUnixTime) {
                offset = targetTs - playbackInfo.firstSegmentUnixTime;
              }
              video.currentTime = Math.max(0, offset);
              initialSeekDone.current = true;
            }
            video.play().catch(() => {});
            setIsPlaying(true);
          }
        };
        return;
      }

      try {
        const mod = await import("hls.js");
        const Hls = mod.default;
        if (!Hls.isSupported()) {
          toast.error("HLS tidak didukung di browser ini");
          return;
        }

        const hls = new Hls({
          maxBufferLength: 30,
          manifestLoadingMaxRetry: 6,
          manifestLoadingRetryDelay: 1000,
        });
        hlsRef.current = hls;

        hls.loadSource(playlistSrc);
        hls.attachMedia(video);
        
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (!disposed) {
            video.muted = isMuted;
            if (stateVal?.eventSeek && stateVal?.timestamp && !initialSeekDone.current) {
              const targetTs = stateVal.timestamp;
              let offset = 0;
              const mappings = playbackInfo.segmentMappings || [];
              if (mappings.length > 0) {
                const closest = mappings.reduce((prev, curr) => {
                  return Math.abs(curr.ts - targetTs) < Math.abs(prev.ts - targetTs) ? curr : prev;
                });
                offset = closest.offset + Math.max(0, targetTs - closest.ts);
              } else if (playbackInfo.firstSegmentUnixTime) {
                offset = targetTs - playbackInfo.firstSegmentUnixTime;
              }
              video.currentTime = Math.max(0, offset);
              initialSeekDone.current = true;
            }
            video.play().catch(() => {});
            setIsPlaying(true);
          }
        });

        let mediaRecoveryAttempts = 0;
        hls.on(Hls.Events.ERROR, (_evt, data) => {
          if (data.fatal) {
            console.error("Fatal HLS error during playback:", data);
            if (data.type === "mediaError") {
              if (mediaRecoveryAttempts < 3) {
                mediaRecoveryAttempts += 1;
                console.log("Attempting media recovery...");
                hls.recoverMediaError();
              } else {
                console.error("Media recovery failed after max retries.");
                setError(t("mediaRecoveryFailed"));
              }
            } else if (data.type === "networkError") {
              console.log("Network error, reloading source...");
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
  }, [playbackInfo, selectedCameraId, selectedDate, playbackWindowMinutes, playbackWindowCenterTs]);

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
    return () => {
      video.removeEventListener("ratechange", handleRateChange);
    };
  }, [playbackSpeed, playbackInfo]);

  // Toggle Video actions
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
    setVolume(newVal);
    const video = videoRef.current;
    if (video) {
      video.volume = newVal;
      if (newVal > 0 && isMuted) {
        setIsMuted(false);
        video.muted = false;
      }
    }
  };

  const toggleFullscreen = () => {
    const container = playerContainerRef.current;
    if (!container) return;
    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(() => {
        toast.error("Gagal masuk layar penuh");
      });
    } else {
      document.exitFullscreen();
    }
  };

  const handleTimeShift = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + seconds));
  };

  const handleVideoTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || !playbackInfo || !playbackInfo.segmentMappings || playbackInfo.segmentMappings.length === 0) return;

    const currentTime = video.currentTime;
    const closest = playbackInfo.segmentMappings.reduce((prev, curr) => {
      return Math.abs(curr.offset - currentTime) < Math.abs(prev.offset - currentTime) ? curr : prev;
    });

    if (closest) {
      const ts = closest.ts + (currentTime - closest.offset);
      setCurrentPlaybackTs(Math.floor(ts));
      setCurrentRecordingTime(new Date(ts * 1000).toLocaleTimeString("id-ID", { hour12: false }));
    }
  };

  // 3. Event and delete helpers
  const seekToEventDirect = (eventTs: string, info: typeof playbackInfo) => {
    const video = videoRef.current;
    if (!video || !info || !info.firstSegmentUnixTime) return;

    // Jump 15s before event
    const eventTime = Math.floor(new Date(eventTs).getTime() / 1000) - 15;

    // If a short HLS window is active, ensure we load HLS playlist around this event
    if (playbackWindowMinutes !== "none") {
      setPlaybackWindowCenterTs(eventTime);
      return;
    }

    let offset = 0;
    const mappings = info.segmentMappings;
    if (Array.isArray(mappings) && mappings.length > 0) {
      const closest = mappings.reduce((prev, curr) => {
        return Math.abs(curr.ts - eventTime) < Math.abs(prev.ts - eventTime) ? curr : prev;
      });
      offset = closest.offset + Math.max(0, eventTime - closest.ts);
    } else {
      offset = eventTime - info.firstSegmentUnixTime;
    }

    video.currentTime = Math.max(0, offset);
    video.muted = isMuted;
    video.play().catch(() => {});
    setIsPlaying(true);
    toast.info(`Melompat ke 15s sebelum deteksi: ${new Date(eventTs).toLocaleTimeString("id-ID", { hour12: false })}`);
  };

  const seekToEvent = (eventTs: string) => {
    seekToEventDirect(eventTs, playbackInfo);
  };

  const handleEventClick = (evt: SmartEvent) => {
    if (selectedCameraId === evt.cameraId) {
      seekToEvent(evt.ts);
    } else {
      const eventLocalDate = new Date(evt.ts).toLocaleDateString("sv-SE");
      autoSeekEventTsRef.current = evt.ts;
      setSelectedCameraId(evt.cameraId);
      setSelectedDate(eventLocalDate);
      toast.info(t("openingCameraDate").replace("{camera}", evt.cameraName).replace("{date}", eventLocalDate));
    }
  };

  const handleDeleteEvent = (evt: SmartEvent) => {
    setDeleteEventTarget(evt);
  };

  const confirmDeleteEvent = async () => {
    if (!deleteEventTarget) return;
    try {
      await eventApi.remove(deleteEventTarget.id);
      toast.success(t("deleteEventSuccess"));
      setEvents((prev) => prev.filter((e) => e.id !== deleteEventTarget.id));
      setDeleteEventTarget(null);
    } catch (err) {
      toast.error(t("failedDeleteEvent"));
    }
  };

  const jumpToPreciseTime = () => {
    const video = videoRef.current;
    if (!video || !playbackInfo) return;

    const parts = preciseTimeInput.split(":");
    if (parts.length < 2) {
      toast.error(t("invalidTimeFormatPrecise"));
      return;
    }

    const hours = parts[0];
    const minutes = parts[1];
    const seconds = parts[2] || "00";

    const targetTimeStr = `${selectedDate}T${hours.padStart(2, "0")}:${minutes.padStart(2, "0")}:${seconds.padStart(2, "0")}`;
    const targetUnix = Math.floor(new Date(targetTimeStr).getTime() / 1000);

    if (isNaN(targetUnix)) {
      toast.error(t("invalidTimeValue"));
      return;
    }

    // Set center if playback window is active
    if (playbackWindowMinutes !== "none") {
      setPlaybackWindowCenterTs(targetUnix);
      return;
    }

    const mappings = playbackInfo.segmentMappings || [];
    if (mappings.length > 0) {
      const closest = mappings.reduce((prev, curr) => {
        return Math.abs(curr.ts - targetUnix) < Math.abs(prev.ts - targetUnix) ? curr : prev;
      });

      const videoOffset = closest.offset + Math.max(0, targetUnix - closest.ts);
      video.currentTime = Math.max(0, videoOffset);
      video.play().catch(() => {});
      setIsPlaying(true);
      toast.success(`Melompat ke ${hours}:${minutes}:${seconds}`);
    } else {
      toast.error("Tidak ada rekaman terekam pada waktu tersebut");
    }
  };

  // Keyboard Shortcuts handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "SELECT" ||
          activeEl.tagName === "TEXTAREA" ||
          activeEl.getAttribute("contenteditable") === "true")
      ) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "arrowleft":
        case "j":
          e.preventDefault();
          if (e.shiftKey) {
            handleTimeShift(-60); // 1 minute
          } else {
            handleTimeShift(-5); // 5 seconds
          }
          break;
        case "arrowright":
        case "l":
          e.preventDefault();
          if (e.shiftKey) {
            handleTimeShift(60); // 1 minute
          } else {
            handleTimeShift(5); // 5 seconds
          }
          break;
        case "m":
          e.preventDefault();
          toggleMute();
          break;
        case "f":
          e.preventDefault();
          toggleFullscreen();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isPlaying, isMuted, volume]);

  // 4. Render timeline canvas details
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !playbackInfo) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    // Clear background
    ctx.fillStyle = "#020617"; // Slate 950
    ctx.fillRect(0, 0, width, height);

    // Day boundaries
    const startOfDay = new Date(`${selectedDate}T00:00:00`);
    const endOfDay = new Date(`${selectedDate}T23:59:59.999`);
    const startUnix = Math.floor(startOfDay.getTime() / 1000);
    const endUnix = Math.floor(endOfDay.getTime() / 1000);

    const windowSizes = {
      "24h": 86400,
      "6h": 6 * 3600,
      "1h": 3600,
      "15m": 15 * 60,
      "5m": 5 * 60,
      "1m": 60,
    };
    const size = windowSizes[timelineZoom];
    
    // Choose current playhead center
    const current = currentPlaybackTs || startUnix;
    const center = timelineCenterTs !== null ? timelineCenterTs : current;

    let zoomStart = center - size / 2;
    let zoomEnd = center + size / 2;
    if (zoomStart < startUnix) {
      zoomStart = startUnix;
      zoomEnd = Math.min(endUnix, startUnix + size);
    }
    if (zoomEnd > endUnix) {
      zoomEnd = endUnix;
      zoomStart = Math.max(startUnix, endUnix - size);
    }

    const timeSpan = zoomEnd - zoomStart;

    // 1. Draw segment green blocks
    const mappings = playbackInfo.segmentMappings || [];
    ctx.fillStyle = "rgba(16, 185, 129, 0.4)"; // emerald-500
    for (const seg of mappings) {
      if (seg.ts + seg.duration >= zoomStart && seg.ts <= zoomEnd) {
        const x = ((seg.ts - zoomStart) / timeSpan) * width;
        const w = (seg.duration / timeSpan) * width;
        ctx.fillRect(x, 0, Math.max(1, w), height - 16);
      }
    }

    // 2. Draw Ticks & Hours/Minutes labels
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
    ctx.font = "9px monospace";
    ctx.textAlign = "center";

    let tickSpacing = 3600;
    if (timelineZoom === "6h") tickSpacing = 1800;
    else if (timelineZoom === "1h") tickSpacing = 600;
    else if (timelineZoom === "15m") tickSpacing = 60;
    else if (timelineZoom === "5m") tickSpacing = 30;
    else if (timelineZoom === "1m") tickSpacing = 5;

    const firstTick = Math.ceil(zoomStart / tickSpacing) * tickSpacing;
    for (let t = firstTick; t <= zoomEnd; t += tickSpacing) {
      const x = ((t - zoomStart) / timeSpan) * width;
      ctx.beginPath();
      ctx.moveTo(x, height - 16);
      ctx.lineTo(x, height - 10);
      ctx.stroke();

      const d = new Date(t * 1000);
      const hStr = String(d.getHours()).padStart(2, "0");
      const mStr = String(d.getMinutes()).padStart(2, "0");
      const sStr = String(d.getSeconds()).padStart(2, "0");
      const label = timelineZoom === "1m" || timelineZoom === "5m" 
        ? `${hStr}:${mStr}:${sStr}` 
        : `${hStr}:${mStr}`;
      ctx.fillText(label, x, height - 3);
    }

    // 3. Draw Event Tick Marks (Red/Amber blocks)
    for (const evt of events) {
      const evtUnix = Math.floor(new Date(evt.ts).getTime() / 1000);
      if (evtUnix >= zoomStart && evtUnix <= zoomEnd) {
        const x = ((evtUnix - zoomStart) / timeSpan) * width;
        ctx.fillStyle = evt.classification === "human" ? "#ef4444" : "#f59e0b"; // red vs amber
        ctx.fillRect(x - 1, 0, 2, height - 16);
      }
    }

    // 4. Draw Yellow Playhead Line & Marker
    if (currentPlaybackTs && currentPlaybackTs >= zoomStart && currentPlaybackTs <= zoomEnd) {
      const x = ((currentPlaybackTs - zoomStart) / timeSpan) * width;
      ctx.strokeStyle = "#fbbf24"; // amber-400
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height - 16);
      ctx.stroke();

      // playhead cap
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath();
      ctx.moveTo(x - 5, 0);
      ctx.lineTo(x + 5, 0);
      ctx.lineTo(x, 6);
      ctx.fill();
    }
  }, [playbackInfo, events, selectedDate, timelineZoom, currentPlaybackTs, timelineCenterTs]);

  // Timeline Interactions: Drag seek / Panning
  const getUnixFromX = (x: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const width = canvas.getBoundingClientRect().width;

    const startOfDay = new Date(`${selectedDate}T00:00:00`);
    const endOfDay = new Date(`${selectedDate}T23:59:59.999`);
    const startUnix = Math.floor(startOfDay.getTime() / 1000);
    const endUnix = Math.floor(endOfDay.getTime() / 1000);

    const windowSizes = {
      "24h": 86400,
      "6h": 6 * 3600,
      "1h": 3600,
      "15m": 15 * 60,
      "5m": 5 * 60,
      "1m": 60,
    };
    const size = windowSizes[timelineZoom];
    const current = currentPlaybackTs || startUnix;
    const center = timelineCenterTs !== null ? timelineCenterTs : current;

    let zoomStart = center - size / 2;
    let zoomEnd = center + size / 2;
    if (zoomStart < startUnix) {
      zoomStart = startUnix;
      zoomEnd = Math.min(endUnix, startUnix + size);
    }
    if (zoomEnd > endUnix) {
      zoomEnd = endUnix;
      zoomStart = Math.max(startUnix, endUnix - size);
    }

    const timeSpan = zoomEnd - zoomStart;
    return zoomStart + (x / width) * timeSpan;
  };

  const handleTimelineMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !playbackInfo) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickUnix = getUnixFromX(clickX);

    // Shift key triggers panning (scrolling the timeline view)
    if (e.shiftKey) {
      setIsPanning(true);
      setDragStartX(e.clientX);
      const current = currentPlaybackTs || clickUnix;
      setDragStartCenter(timelineCenterTs !== null ? timelineCenterTs : current);
    } else {
      // Direct click to seek anywhere on timeline
      setIsScrubbing(true);
      setDragStartX(e.clientX);
      dragStartPlayheadRef.current = clickUnix;
      setCurrentPlaybackTs(clickUnix);
      setCurrentRecordingTime(new Date(clickUnix * 1000).toLocaleTimeString("id-ID", { hour12: false }));
      
      const video = videoRef.current;
      if (video) {
        const mappings = playbackInfo.segmentMappings || [];
        if (mappings.length > 0) {
          const closest = mappings.reduce((prev, curr) => {
            return Math.abs(curr.ts - clickUnix) < Math.abs(prev.ts - clickUnix) ? curr : prev;
          });
          const videoOffset = closest.offset + Math.max(0, clickUnix - closest.ts);
          video.currentTime = Math.max(0, videoOffset);
        }
      }
    }
  };

  const handleTimelineMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !playbackInfo) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const currentUnix = getUnixFromX(mouseX);

    // Show hovered time thumbnail preview
    setHoverInfo({
      x: mouseX,
      time: currentUnix,
      show: true,
    });

    if (isScrubbing) {
      const startOfDay = new Date(`${selectedDate}T00:00:00`);
      const endOfDay = new Date(`${selectedDate}T23:59:59.999`);
      const startUnix = Math.floor(startOfDay.getTime() / 1000);
      const endUnix = Math.floor(endOfDay.getTime() / 1000);

      const windowSizes = {
        "24h": 86400,
        "6h": 6 * 3600,
        "1h": 3600,
        "15m": 15 * 60,
        "5m": 5 * 60,
        "1m": 60,
      };
      const size = windowSizes[timelineZoom];
      const current = currentPlaybackTs || startUnix;
      const center = timelineCenterTs !== null ? timelineCenterTs : current;
      let zoomStart = center - size / 2;
      let zoomEnd = center + size / 2;
      if (zoomStart < startUnix) {
        zoomStart = startUnix;
        zoomEnd = Math.min(endUnix, startUnix + size);
      }
      if (zoomEnd > endUnix) {
        zoomEnd = endUnix;
        zoomStart = Math.max(startUnix, endUnix - size);
      }
      const timeSpan = zoomEnd - zoomStart;

      const sensitivities = {
        "24h": 0.05,  // 20x slower
        "6h": 0.15,   // 6.7x slower
        "1h": 0.35,   // 3x slower
        "15m": 0.7,   // 1.4x slower
        "5m": 1.0,
        "1m": 1.0,
      };
      const sensitivity = sensitivities[timelineZoom] || 1.0;
      const deltaX = e.clientX - dragStartX;
      const timeDelta = (deltaX / rect.width) * timeSpan * sensitivity;
      const startPlayhead = dragStartPlayheadRef.current !== null ? dragStartPlayheadRef.current : currentUnix;
      const scrubUnix = Math.max(startUnix, Math.min(endUnix, startPlayhead + timeDelta));

      // Update playhead immediately for smooth visual scrubbing feedback
      setCurrentPlaybackTs(scrubUnix);
      setCurrentRecordingTime(new Date(scrubUnix * 1000).toLocaleTimeString("id-ID", { hour12: false }));

      const video = videoRef.current;
      if (video) {
        const mappings = playbackInfo.segmentMappings || [];
        if (mappings.length > 0) {
          const closest = mappings.reduce((prev, curr) => {
            return Math.abs(curr.ts - scrubUnix) < Math.abs(prev.ts - scrubUnix) ? curr : prev;
          });
          const videoOffset = closest.offset + Math.max(0, scrubUnix - closest.ts);
          video.currentTime = Math.max(0, videoOffset);
        }
      }
    } else if (isPanning && dragStartCenter !== null) {
      const width = rect.width;
      const windowSizes = {
        "24h": 86400,
        "6h": 6 * 3600,
        "1h": 3600,
        "15m": 15 * 60,
        "5m": 5 * 60,
        "1m": 60,
      };
      const size = windowSizes[timelineZoom];
      const deltaX = e.clientX - dragStartX;
      const timeDelta = -(deltaX / width) * size;
      setTimelineCenterTs(dragStartCenter + timeDelta);
    }
  };

  const handleTimelineMouseUp = () => {
    setIsScrubbing(false);
    setIsPanning(false);
    setDragStartCenter(null);
    dragStartPlayheadRef.current = null;
  };

  const handleTimelineMouseLeave = () => {
    setHoverInfo((prev) => ({ ...prev, show: false }));
    setIsScrubbing(false);
    setIsPanning(false);
    dragStartPlayheadRef.current = null;
  };

  const handleCanvasWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const direction = e.deltaY < 0 ? -1 : 1;
    let shiftSecs = 10;
    if (timelineZoom === "24h") shiftSecs = 120;
    else if (timelineZoom === "6h") shiftSecs = 30;
    else if (timelineZoom === "1h") shiftSecs = 10;
    else if (timelineZoom === "15m") shiftSecs = 5;
    else if (timelineZoom === "5m") shiftSecs = 2;
    else shiftSecs = 1;

    handleTimeShift(direction * shiftSecs);
  };

  // Custom clip download range
  const handleDownload = () => {
    if (!selectedCameraId || !playbackInfo || !playbackInfo.firstSegmentUnixTime) return;

    const startParts = downloadStart.split(":");
    const endParts = downloadEnd.split(":");
    if (startParts.length !== 2 || endParts.length !== 2) {
      toast.error(t("invalidTimeFormat"));
      return;
    }

    const startTimeStr = `${selectedDate}T${startParts[0]}:${startParts[1]}:00`;
    const endTimeStr = `${selectedDate}T${endParts[0]}:${endParts[1]}:00`;
    const startUnix = Math.floor(new Date(startTimeStr).getTime() / 1000);
    const endUnix = Math.floor(new Date(endTimeStr).getTime() / 1000);

    if (isNaN(startUnix) || isNaN(endUnix)) {
      toast.error(t("invalidTimeValue"));
      return;
    }

    if (startUnix >= endUnix) {
      toast.error(t("startTimeBeforeEndTime"));
      return;
    }

    const firstRec = playbackInfo.firstSegmentUnixTime;
    const lastRec = playbackInfo.lastSegmentUnixTime || (firstRec + 86400);

    if (endUnix < firstRec || startUnix > lastRec) {
      toast.error(t("timeRangeNoRecordings"));
      return;
    }

    setPreviewStartTs(startUnix);
    setPreviewEndTs(endUnix);
    setIsPreviewDownloadOpen(true);
  };

  const triggerDownloadMp4 = () => {
    if (!selectedCameraId || !previewStartTs || !previewEndTs) return;
    const dlLink = downloadUrl(selectedCameraId, previewStartTs, previewEndTs);
    window.open(dlLink, "_blank");
    toast.success(t("exportingClipMp4"));
    setIsPreviewDownloadOpen(false);
  };

  // Event Sidebar filtering
  const filteredEvents = events.filter((evt) => {
    // 1. Keyword filter
    const keyword = searchKeyword.toLowerCase();
    const label = getClassificationLabel(evt.classification, evt.typeDescription, t).toLowerCase();
    const matchKeyword = !searchKeyword || label.includes(keyword) || evt.id.toLowerCase().includes(keyword);

    // 2. Score threshold filter
    const matchScore = (evt.score || 0) >= minScore;

    // 3. Time filter range
    const dateObj = new Date(evt.ts);
    const hours = dateObj.getHours();
    const minutes = dateObj.getMinutes();
    const evtMinutes = hours * 60 + minutes;

    const [startH, startM] = filterStartTime.split(":").map(Number);
    const [endH, endM] = filterEndTime.split(":").map(Number);
    const startMinutes = (startH || 0) * 60 + (startM || 0);
    const endMinutes = (endH || 23) * 60 + (endM || 59);
    const matchTime = evtMinutes >= startMinutes && evtMinutes <= endMinutes;

    return matchKeyword && matchScore && matchTime;
  });

  return (
    <div className="space-y-6 max-w-7xl pb-10 select-none">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight">
          {t("playback")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("playbackSubtitle")}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Main Player and Timeline (takes 3 cols on large screens) */}
        <div className="lg:col-span-3 space-y-6">
          <Card 
            ref={playerContainerRef} 
            className="overflow-hidden bg-slate-950 aspect-video relative flex items-center justify-center border border-border/40 shadow-glow group"
          >
            {loading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/85 z-25 text-white text-xs gap-2">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <span>{t("loadingSegments")}</span>
              </div>
            )}

            {!selectedCameraId ? (
              <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
                <PlayCircle className="h-12 w-12 text-primary/45 mb-3 animate-pulse" />
                <h3 className="font-semibold text-sm text-white/85">{t("pleaseSelectCamera")}</h3>
                <p className="text-xs text-white/45 max-w-xs mt-1">
                  {t("selectCameraPlaybackHelp")}
                </p>
              </div>
            ) : playbackInfo?.hasRecording ? (
              <video
                ref={videoRef}
                className="w-full h-full object-contain cursor-pointer"
                crossOrigin="anonymous"
                muted={isMuted}
                onTimeUpdate={handleVideoTimeUpdate}
                onWaiting={() => {
                  const v = videoRef.current;
                  if (v && !v.paused) {
                    setIsBuffering(true);
                  }
                }}
                onPlaying={() => setIsBuffering(false)}
                onPause={() => {
                  setIsPlaying(false);
                  setIsBuffering(false);
                }}
                onPlay={() => setIsPlaying(true)}
                onClick={togglePlay}
              />
            ) : (
              <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
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
                  <div className="text-[11px] text-white/60 max-w-md">{error}</div>
                </div>
                <Button size="sm" onClick={loadPlaybackData} className="h-8 text-xs font-medium">
                  {t("retry")}
                </Button>
              </div>
            )}

            {/* Custom Control Overlay (visible on hover) */}
            {playbackInfo?.hasRecording && (
              <div className="absolute bottom-4 inset-x-4 bg-slate-950/75 backdrop-blur-md border border-white/10 p-3 flex items-center justify-between shadow-2xl opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-300 z-10 pointer-events-auto rounded-xl">
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 text-white hover:bg-white/10 hover:text-white rounded-lg transition-colors"
                    onClick={togglePlay}
                  >
                    {isPlaying ? <Pause className="h-4.5 w-4.5" /> : <Play className="h-4.5 w-4.5 text-primary-foreground fill-white" />}
                  </Button>
                  
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 text-white hover:bg-white/10 hover:text-white rounded-lg transition-colors"
                    onClick={() => handleTimeShift(-10)}
                    title={t("rewind10s")}
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                  
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 text-white hover:bg-white/10 hover:text-white rounded-lg transition-colors"
                    onClick={() => handleTimeShift(10)}
                    title={t("forward10s")}
                  >
                    <RotateCw className="h-4 w-4" />
                  </Button>

                  <div className="flex items-center gap-1 group/volume ml-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-white hover:bg-white/10 hover:text-white rounded-lg transition-colors"
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
                      className="w-16 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-primary group-hover/volume:w-20 transition-all duration-200"
                    />
                  </div>
                </div>

                {/* Settings / Speed / Screen */}
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 text-white text-xs font-semibold">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider">{t("speed")}</span>
                    <Select
                      value={String(playbackSpeed)}
                      onValueChange={(val) => setPlaybackSpeed(parseFloat(val))}
                    >
                      <SelectTrigger className="w-[72px] h-7 bg-slate-900/60 hover:bg-slate-900/80 text-white border-white/10 text-xs px-2 py-0 rounded-lg transition-colors">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-900 border border-white/10 text-white">
                        <SelectItem value="0.5" className="hover:bg-white/5 focus:bg-white/5">0.5x</SelectItem>
                        <SelectItem value="1" className="hover:bg-white/5 focus:bg-white/5">1x</SelectItem>
                        <SelectItem value="1.5" className="hover:bg-white/5 focus:bg-white/5">1.5x</SelectItem>
                        <SelectItem value="2" className="hover:bg-white/5 focus:bg-white/5">2x</SelectItem>
                        <SelectItem value="5" className="hover:bg-white/5 focus:bg-white/5">5x</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 text-white hover:bg-white/10 hover:text-white rounded-lg transition-colors"
                    onClick={toggleFullscreen}
                  >
                    <Maximize className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </Card>

          {playbackInfo?.hasRecording && (
            <Card className="p-4 border border-border/40 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <PlayCircle className="h-4 w-4 text-primary animate-pulse" />
                  <span className="text-xs font-semibold text-foreground">{t("recordingTime")}:</span>
                  <span className="text-xs font-mono bg-primary/10 border border-primary/20 text-primary px-2.5 py-1 rounded">
                    {currentRecordingTime || "--:--:--"}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground font-medium">{t("zoomScale")}:</span>
                  {["24h", "6h", "1h", "15m", "5m", "1m"].map((z) => (
                    <Button
                      key={z}
                      size="sm"
                      variant={timelineZoom === z ? "default" : "outline"}
                      className="h-7 px-2 text-xs font-semibold"
                      onClick={() => {
                        setTimelineZoom(z as typeof timelineZoom);
                        setTimelineCenterTs(null);
                      }}
                    >
                      {z === "24h" ? t("zoom24h") : z === "6h" ? t("zoom6h") : z === "1h" ? t("zoom1h") : z}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Seek time tools */}
              <div className="flex flex-wrap items-center gap-4 pt-3 border-t border-border/10">
                <div className="flex items-center gap-2 flex-1 min-w-[240px]">
                  <Label className="text-xs shrink-0 font-medium">{t("jumpSpecific")}</Label>
                  <input
                    type="text"
                    placeholder="HH:MM:SS"
                    value={preciseTimeInput}
                    onChange={(e) => setPreciseTimeInput(e.target.value.replace(/[^0-9:]/g, ""))}
                    className="max-w-[100px] px-2.5 py-1 rounded-md border bg-background text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <Button size="sm" onClick={jumpToPreciseTime} className="h-7 text-xs font-medium">
                    {t("jump")}
                  </Button>
                </div>
                <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Info className="h-3 w-3" />
                  <span>{t("timelineScrollHelp")}</span>
                </div>
              </div>

              {/* Interactive Timeline Canvas container */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-muted-foreground font-semibold px-0.5">
                  <span>{t("startDate")}</span>
                  <span>Interactive Visual Seekbar</span>
                  <span>{t("endDate")}</span>
                </div>
                <div className="relative border border-border/40 rounded-md overflow-hidden bg-slate-950 shadow-inner h-16">
                  <canvas
                    ref={canvasRef}
                    onMouseDown={handleTimelineMouseDown}
                    onMouseMove={handleTimelineMouseMove}
                    onMouseUp={handleTimelineMouseUp}
                    onMouseLeave={handleTimelineMouseLeave}
                    onWheel={handleCanvasWheel}
                    className="w-full h-full cursor-ew-resize"
                  />

                  {/* YouTube Hover Tooltip */}
                  {hoverInfo.show && (
                    <div 
                      className="absolute bottom-16 bg-slate-950/95 border border-border/60 rounded-md p-1.5 shadow-2xl pointer-events-none z-30 flex flex-col items-center gap-1 min-w-[120px] animate-fade-in"
                      style={{ left: `${hoverInfo.x}px`, transform: "translateX(-50%)" }}
                    >
                      <span className="text-[10px] font-mono text-white/90">
                        {new Date(hoverInfo.time * 1000).toLocaleTimeString("id-ID", { hour12: false })}
                      </span>
                      <div className="w-24 h-16 bg-black rounded overflow-hidden relative border border-white/10 flex items-center justify-center">
                        <img
                          src={`${API_BASE}/api/streams/${selectedCameraId}/snapshot-at?time=${Math.floor(hoverInfo.time)}&token=${encodeURIComponent(getApiToken() || "")}`}
                          alt="Preview"
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = "none";
                          }}
                        />
                        <div className="absolute inset-0 flex items-center justify-center text-[9px] text-muted-foreground/60 select-none bg-black/40 z-0">
                          No Frame
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          )}

          {/* Download clip form */}
          {playbackInfo?.hasRecording && (
            <Card className="p-5 border border-border/40 space-y-4">
              <div className="flex items-center gap-2 font-medium text-sm text-primary">
                <Download className="h-4 w-4" />
                <span>{t("customClipDownload")}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("exportHlsClipHelp").replace("{date}", selectedDate)}
              </p>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 items-end">
                <div className="space-y-1">
                  <Label className="text-xs">{t("startTime")}</Label>
                  <input
                    type="text"
                    placeholder="12:00"
                    value={downloadStart}
                    onChange={(e) => setDownloadStart(e.target.value.replace(/[^0-9:]/g, ""))}
                    className="w-full px-3 py-1.5 rounded-md border bg-background text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">{t("endTime")}</Label>
                  <input
                    type="text"
                    placeholder="12:05"
                    value={downloadEnd}
                    onChange={(e) => setDownloadEnd(e.target.value.replace(/[^0-9:]/g, ""))}
                    className="w-full px-3 py-1.5 rounded-md border bg-background text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <Button onClick={handleDownload} className="col-span-2 md:col-span-1">
                  <Download className="h-4 w-4 mr-2" />
                  {t("startExport")}
                </Button>
              </div>
            </Card>
          )}
        </div>

        {/* Sidebar Controls and Event Search Filters */}
        <div className="space-y-6">
          <Card className="p-5 border border-border/40 space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">{t("selectCamera")}</Label>
              <Popover open={isCameraPopoverOpen} onOpenChange={setIsCameraPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={isCameraPopoverOpen}
                    className="w-full justify-between font-normal text-left h-10 bg-background border-border text-sm"
                  >
                    <span className="truncate">
                      {cameras.find((c) => c.id === selectedCameraId)?.name || t("selectCamera")}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[300px] p-3 space-y-3" align="start">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder={t("searchCameraPlaceholder")}
                      value={cameraSearchQuery}
                      onChange={(e) => setCameraSearchQuery(e.target.value)}
                      className="pl-8 h-8 text-xs"
                    />
                  </div>
                  <ScrollArea className="h-60">
                    <div className="space-y-1 pr-2">
                      {filteredCameras.length === 0 ? (
                        <div className="text-xs text-muted-foreground p-3 text-center">
                          {t("cameraNotFound")}
                        </div>
                      ) : (
                        filteredCameras.map((c) => (
                          <button
                            key={c.id}
                            onClick={() => {
                              setSelectedCameraId(c.id);
                              setIsCameraPopoverOpen(false);
                            }}
                            className={cn(
                              "w-full text-left p-2 rounded-md transition-colors text-xs flex flex-col gap-0.5 hover:bg-accent/50",
                              selectedCameraId === c.id && "bg-primary/10 text-primary font-medium border border-primary/20"
                            )}
                          >
                            <span className="font-semibold truncate">{c.name}</span>
                            <span className="text-[10px] text-muted-foreground truncate">
                              {c.site} · {c.ip} · {c.brand}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">{t("selectDate")}</Label>
              <div className="relative">
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="w-full pl-10 pr-3 py-2 rounded-md border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <Calendar className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground/60" />
              </div>
            </div>

            {/* Playback Load Window Filter */}
            <div className="space-y-1 pt-1.5 border-t border-border/10">
              <Label className="text-xs font-semibold text-primary">{t("loadWindowLimit")}</Label>
              <Select 
                value={playbackWindowMinutes} 
                onValueChange={(val) => {
                  setPlaybackWindowMinutes(val);
                  if (val !== "none") {
                    // Default center to current time
                    setPlaybackWindowCenterTs(currentPlaybackTs || Math.floor(new Date(`${selectedDate}T12:00:00`).getTime() / 1000));
                  } else {
                    setPlaybackWindowCenterTs(null);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("unlimitedFullDay")}</SelectItem>
                  <SelectItem value="1">{t("minutesUnit").replace("{n}", "1")}</SelectItem>
                  <SelectItem value="5">{t("minutesUnit").replace("{n}", "5")}</SelectItem>
                  <SelectItem value="15">{t("minutesUnit").replace("{n}", "15")}</SelectItem>
                  <SelectItem value="30">{t("minutesUnit").replace("{n}", "30")}</SelectItem>
                  <SelectItem value="60">{t("hoursUnit").replace("{n}", "1")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground italic leading-tight">
                {t("loadWindowHelp")}
              </p>
            </div>

            {selectedCameraId && playbackInfo && (
              <div className="text-xs text-muted-foreground pt-2 border-t border-border/10 flex items-center justify-between">
                <span>{t("diskUsage")}</span>
                <span className="font-semibold text-foreground font-mono bg-slate-900 border border-border/45 px-1.5 py-0.5 rounded">
                  {formatBytes(playbackInfo.diskUsageBytes)}
                </span>
              </div>
            )}
          </Card>

          {/* Event Search and Filter Controls */}
          {playbackInfo?.hasRecording && (
            <Card className="p-5 border border-border/40 space-y-4">
              <div className="flex items-center gap-1.5 font-semibold text-xs border-b pb-2 mb-1">
                <SlidersHorizontal className="h-4 w-4 text-primary" />
                <span>{t("motionMarkerFilter")}</span>
              </div>

              {/* Keyword Search */}
              <div className="space-y-1">
                <Label className="text-xs">{t("searchDetailType")}</Label>
                <div className="relative">
                  <Input
                    placeholder="Keyword..."
                    value={searchKeyword}
                    onChange={(e) => setSearchKeyword(e.target.value)}
                    className="h-8 text-xs pl-8"
                  />
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                </div>
              </div>

              {/* Min Activity Score */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <Label>{t("minActivityScore")}</Label>
                  <span className="font-mono text-primary font-semibold">{minScore}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={minScore}
                  onChange={(e) => setMinScore(Number(e.target.value))}
                  className="w-full h-1 bg-slate-900 border border-border/45 rounded-lg appearance-none cursor-pointer accent-primary"
                />
              </div>

              {/* Time Range */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px]">{t("fromHour")}</Label>
                  <input
                    type="text"
                    placeholder="00:00"
                    value={filterStartTime}
                    onChange={(e) => setFilterStartTime(e.target.value.replace(/[^0-9:]/g, ""))}
                    className="w-full px-2 py-1 border rounded bg-background text-xs font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">{t("toHour")}</Label>
                  <input
                    type="text"
                    placeholder="23:59"
                    value={filterEndTime}
                    onChange={(e) => setFilterEndTime(e.target.value.replace(/[^0-9:]/g, ""))}
                    className="w-full px-2 py-1 border rounded bg-background text-xs font-mono"
                  />
                </div>
              </div>
            </Card>
          )}

          {/* Event markers list */}
          {(!selectedCameraId || playbackInfo?.hasRecording) && (
            <Card className="p-5 border border-border/40 flex-1 flex flex-col min-h-[350px] max-h-[550px] overflow-hidden">
              <div className="flex items-center justify-between pb-3 border-b mb-3">
                <h3 className="font-semibold text-xs">
                  {selectedCameraId ? t("motionMarkers") : t("recentMotionActivityAll")}
                </h3>
                <span className="text-[10px] text-muted-foreground bg-muted dark:bg-slate-900 border border-border/40 px-1.5 py-0.5 rounded font-mono">
                  {t("nMatched").replace("{n}", String(filteredEvents.length))}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto space-y-3 pr-1 select-none py-1">
                {filteredEvents.length === 0 ? (
                  <div className="text-xs text-muted-foreground text-center py-12">
                    {t("noMotionDetectedMatch")}
                  </div>
                ) : (
                  filteredEvents.map((evt) => {
                    const badge = getClassificationBadge(evt.classification, t);
                    const isHuman = evt.classification === "human";
                    const isPet = evt.classification === "pet";
                    const isPixel = evt.classification === "pixel";
                    
                    return (
                      <div
                        key={evt.id}
                        className="group flex gap-3 relative pb-4 last:pb-0"
                      >
                        {/* Vertical Timeline Axis */}
                        <div className="flex flex-col items-center shrink-0 relative">
                          <div className={`h-3 w-3 rounded-full border-2 bg-background dark:bg-slate-955 z-5 transition-all duration-300 ${
                            isHuman 
                              ? "border-rose-500 shadow-[0_0_8px_#f43f5e]" 
                              : isPet 
                                ? "border-emerald-500 shadow-[0_0_8px_#10b981]" 
                                : isPixel 
                                  ? "border-blue-500 shadow-[0_0_8px_#3b82f6]" 
                                  : "border-amber-500 shadow-[0_0_8px_#f59e0b]"
                          }`} />
                          <div className="w-0.5 bg-border/20 flex-1 absolute top-3 bottom-0" />
                        </div>

                        {/* Node Card */}
                        <div
                          className="flex-1 group/item flex items-center justify-between gap-3 p-2 rounded-xl border border-border/40 dark:border-white/5 bg-card/60 hover:bg-muted/50 dark:bg-slate-900/20 dark:hover:bg-slate-900/60 hover:border-primary/20 transition-all duration-300 shadow-sm relative overflow-hidden"
                        >
                          <div 
                            onClick={() => handleEventClick(evt)}
                            className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer animate-fade-in"
                          >
                            <div className="w-14 h-9 bg-muted/40 dark:bg-slate-950 border border-border/40 dark:border-white/5 rounded-lg overflow-hidden relative shrink-0">
                              <img
                                src={eventApi.snapshotUrl(evt.id)}
                                alt="Event"
                                loading="lazy"
                                className="w-full h-full object-cover transition-transform duration-500 group-hover/item:scale-105"
                                onError={(e) => {
                                  (e.target as HTMLElement).style.display = "none";
                                }}
                              />
                              <div className={cn(
                                "absolute bottom-0.5 right-0.5 p-0.5 rounded-sm border backdrop-blur-sm z-10",
                                badge.bgColor
                              )}>
                                {badge.icon}
                              </div>
                            </div>
                            <div className="leading-tight min-w-0 flex-1 space-y-0.5">
                              {!selectedCameraId && (
                                <div className="text-[9px] uppercase tracking-wider font-semibold text-primary truncate">
                                  {evt.cameraName}
                                </div>
                              )}
                              <div className="text-[10px] text-muted-foreground dark:text-slate-400 flex flex-col gap-0.5 font-mono">
                                <span>{t("startLabel")} {new Date(new Date(evt.ts).getTime() - 15000).toLocaleTimeString("id-ID", { hour12: false })}</span>
                                <span className="text-[11px] font-bold text-foreground dark:text-slate-200 font-sans mt-0.5">
                                  {getClassificationLabel(evt.classification, evt.typeDescription, t)}
                                </span>
                                <span>{t("untilLabel")} {new Date(new Date(evt.ts).getTime() + 15000).toLocaleTimeString("id-ID", { hour12: false })}</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 opacity-0 group-hover/item:opacity-100 transition-opacity duration-200 shrink-0 z-5">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground dark:text-slate-400 hover:text-foreground dark:hover:text-white hover:bg-muted dark:hover:bg-white/10 rounded-md"
                              onClick={() => handleEventClick(evt)}
                              title={t("playback")}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-rose-400 hover:text-rose-300 hover:bg-rose-500/25 rounded-md"
                              onClick={() => handleDeleteEvent(evt)}
                              title={t("deleteEvent")}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Pratinjau Unduhan Dialog */}
      <Dialog open={isPreviewDownloadOpen} onOpenChange={setIsPreviewDownloadOpen}>
        <DialogContent className="max-w-3xl p-5 border border-border/40 space-y-4">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">{t("clipExportPreview")}</DialogTitle>
          </DialogHeader>
          
          <div className="relative aspect-video bg-black rounded overflow-hidden border border-white/10 flex items-center justify-center">
            <video
              ref={previewVideoRef}
              className="w-full h-full object-contain"
              controls
              crossOrigin="anonymous"
            />
          </div>

          <div className="text-xs text-muted-foreground space-y-1 pt-1.5 font-mono">
            <div>{t("cameraName")}: <span className="text-foreground font-semibold">{cameras.find(c => c.id === selectedCameraId)?.name}</span></div>
            <div>{t("dateLabel")}: <span className="text-foreground font-semibold">{selectedDate}</span></div>
            <div>{t("timeRange")}: <span className="text-foreground font-semibold">
              {previewStartTs && new Date(previewStartTs * 1000).toLocaleTimeString("id-ID", { hour12: false })}{t("toLabel")}{previewEndTs && new Date(previewEndTs * 1000).toLocaleTimeString("id-ID", { hour12: false })}
            </span></div>
            <div>{t("duration")}: <span className="text-foreground font-semibold">
              {previewStartTs && previewEndTs ? `${previewEndTs - previewStartTs} ${t("secondsUnit")}` : `0 ${t("secondsUnit")}`}
            </span></div>
          </div>

          <DialogFooter className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setIsPreviewDownloadOpen(false)}>
              {t("cancel")}
            </Button>
            <Button size="sm" onClick={triggerDownloadMp4} className="bg-gradient-primary">
              <Download className="h-4 w-4 mr-1.5" />
              {t("downloadMp4")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Konfirmasi Hapus Event */}
      <ConfirmDialog
        open={!!deleteEventTarget}
        onOpenChange={(o) => !o && setDeleteEventTarget(null)}
        title={t("deleteDetectionEvent")}
        description={t("deleteEventConfirmDesc")
          .replace("{camera}", deleteEventTarget?.cameraName || "")
          .replace("{time}", deleteEventTarget ? new Date(deleteEventTarget.ts).toLocaleTimeString("id-ID", { hour12: false }) : "")
        }
        confirmText={t("delete")}
        variant="destructive"
        onConfirm={confirmDeleteEvent}
      />
    </div>
  );
}
