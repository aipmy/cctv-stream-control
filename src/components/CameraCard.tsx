import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Home,
  Maximize2,
  Minimize2,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  MapPin,
  Volume2,
  VolumeX,
  Users,
  Gauge,
  Radio,
  Activity,
  Pin,
  PinOff,
} from "lucide-react";
import type { Camera } from "@/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/store";
import { CameraLiveView } from "@/components/CameraLiveView";
import { cameraApi } from "@/lib/api";
import { formatByteRateFromBytes, formatByteRateFromKbps } from "@/lib/bandwidth";
import { toast } from "sonner";

interface Props {
  camera: Camera;
  onRestart: (c: Camera) => void;
  onEdit: (c: Camera) => void;
  onDelete: (c: Camera) => void;
  pinned: boolean;
  onTogglePin: (c: Camera) => void;
}

function timeAgo(iso: string, t: (key: any, params?: any) => string) {
  const d = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (d < 60) return t("secAgo", { n: d });
  if (d < 3600) return t("minAgo", { n: Math.floor(d / 60) });
  if (d < 86400) return t("hourAgo", { n: Math.floor(d / 3600) });
  return t("dayAgo", { n: Math.floor(d / 86400) });
}

const streamColors: Record<Camera["streamType"], string> = {
  "HLS Stable": "bg-info/10 text-info border-info/30",
  "HLS Low Latency": "bg-primary/10 text-primary border-primary/30",
  MJPEG: "bg-warning/10 text-warning border-warning/30",
};

const statusColors: Record<Camera["status"], string> = {
  online: "bg-emerald-500/15 text-emerald-300 border-emerald-400/30",
  starting: "bg-yellow-500/15 text-yellow-200 border-yellow-400/30",
  offline: "bg-red-500/10 text-red-200 border-red-400/25",
};

type PtzAction = "up" | "down" | "left" | "right" | "home" | "zoomIn" | "zoomOut" | "stop";

function audioKey(id: string) {
  return `cctv-audio-state-v2:${id}`;
}

function readAudioState(camera: Camera) {
  if (typeof window === "undefined") return { muted: true, volume: 0 };
  try {
    const saved = JSON.parse(localStorage.getItem(audioKey(camera.id)) || "null");
    if (saved && typeof saved === "object") {
      const volume = Number.isFinite(Number(saved.volume)) ? Math.max(0, Math.min(1, Number(saved.volume))) : 0;
      return { muted: Boolean(saved.muted) || volume <= 0, volume };
    }
  } catch {
    // ignore
  }
  // Default harus mute dan 0% agar refresh / kamera baru tidak tiba-tiba bersuara.
  return { muted: true, volume: 0 };
}

function statusLabel(camera: Camera) {
  if (!camera.enabled) return "disabled";
  return camera.status;
}

type PtzFeedback = "sending" | "success" | "warning" | "failure";

import { useTranslation } from "@/hooks/useTranslation";

export function CameraCard({ camera, onRestart, onEdit, onDelete, pinned, onTogglePin }: Props) {
  const user = useAuth((s) => s.user);
  const role = user?.role;
  const perms = user?.permissions;
  
  const canEdit = role === "admin" || !!perms?.canEditCamera;
  const canDelete = role === "admin" || !!perms?.canDeleteCamera;
  const canRestart = role === "admin" || !!perms?.canRestartStream;

  const { t, tError } = useTranslation();
  const latestError = camera.errorHistory?.[camera.errorHistory.length - 1];
  const isError = camera.status === "offline" && !!latestError;
  const badgeTooltip = isError ? (tError(latestError?.message) || "") : "";
  const canUseAudio = role === "admin" || !!perms?.canPlayAudio;
  const canUsePtz = role === "admin" || !!perms?.canControlPTZ;
  const canSeeIp = role !== "guest";
  const isDisabled = !camera.enabled;
  const ptzAvailable = canUsePtz && camera.enabled && camera.enablePTZ && camera.sourceType === "RTSP+ONVIF";
  const audioAvailable = canUseAudio && camera.audioMode !== "Disable" && camera.streamType !== "MJPEG";

  const cardRef = useRef<HTMLDivElement | null>(null);
  const hideTimer = useRef<number | null>(null);
  const stopTimer = useRef<number | null>(null);
  const activePtzPointer = useRef<number | null>(null);
  const feedbackTimer = useRef<number | null>(null);
  const [audio, setAudio] = useState(() => readAudioState(camera));
  const [controlsVisible, setControlsVisible] = useState(false);
  const [ptzFeedback, setPtzFeedback] = useState<PtzFeedback | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    setAudio(readAudioState(camera));
  }, [camera.id]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(audioKey(camera.id), JSON.stringify(audio));
  }, [camera.id, audio]);

  useEffect(() => () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    if (stopTimer.current) window.clearTimeout(stopTimer.current);
    if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current);
  }, []);

  // Track fullscreen state changes (including ESC key exit)
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const onFsChange = () => {
      setIsFullscreen(document.fullscreenElement === el);
    };
    el.addEventListener("fullscreenchange", onFsChange);
    return () => el.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const effectiveMuted = !audioAvailable || audio.muted || audio.volume <= 0.02;
  const effectiveVolume = audioAvailable && !effectiveMuted ? audio.volume : 0;
  const volumePct = Math.round(audio.volume * 100);
  const outRate = camera.outBytesPerSec !== undefined ? formatByteRateFromBytes(camera.outBytesPerSec) : formatByteRateFromKbps(camera.bandwidthKbps || 0);
  const pullRate = camera.pullBytesPerSec !== undefined ? formatByteRateFromBytes(camera.pullBytesPerSec) : formatByteRateFromKbps(camera.pullBandwidthKbps || 0);

  const revealControls = () => {
    setControlsVisible(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), 3000);
  };

  const hideControls = () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
    setControlsVisible(false);
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement === cardRef.current) {
        await document.exitFullscreen();
      } else {
        await cardRef.current?.requestFullscreen?.();
      }
    } catch {
      toast.error(t("browserDeniedFullscreen"));
    }
  };

  const showPtzFeedback = (status: PtzFeedback) => {
    setPtzFeedback(status);
    if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current);
    if (status !== "sending") {
      feedbackTimer.current = window.setTimeout(() => setPtzFeedback(null), 2600);
    }
  };

  const sendPtz = async (action: PtzAction) => {
    if (!ptzAvailable) return;
    showPtzFeedback("sending");
    try {
      const result = await cameraApi.ptz(camera.id, action);
      showPtzFeedback(result.warning ? "warning" : "success");
      return result;
    } catch (err) {
      showPtzFeedback("failure");
      toast.error(err instanceof Error ? err.message : "PTZ gagal");
      throw err;
    }
  };

  const holdPtz = (action: PtzAction) => {
    void sendPtz(action).catch(() => undefined);
    if (stopTimer.current) window.clearTimeout(stopTimer.current);
    stopTimer.current = window.setTimeout(() => {
      activePtzPointer.current = null;
      stopTimer.current = null;
      void sendPtz("stop").catch(() => undefined);
    }, 550);
  };

  const stopPtz = (pointerId?: number) => {
    if (pointerId !== undefined && activePtzPointer.current !== pointerId) return;
    activePtzPointer.current = null;
    if (stopTimer.current) window.clearTimeout(stopTimer.current);
    void sendPtz("stop").catch(() => undefined);
  };

  const ptzButton = (action: PtzAction, icon: ReactNode, label: string, extra = "") => (
    <button
      type="button"
      title={label}
      disabled={!ptzAvailable}
      onPointerDown={(e) => {
        e.preventDefault();
        activePtzPointer.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        holdPtz(action);
      }}
      onPointerUp={(e) => stopPtz(e.pointerId)}
      onPointerCancel={(e) => stopPtz(e.pointerId)}
      onLostPointerCapture={(e) => stopPtz(e.pointerId)}
      className={cn(
        "h-7 w-7 rounded-md bg-black/55 text-white/90 border border-white/15 backdrop-blur-sm inline-flex items-center justify-center hover:bg-black/75 disabled:opacity-35 disabled:cursor-not-allowed",
        extra,
      )}
    >
      {icon}
    </button>
  );

  return (
    <Card className="overflow-hidden border-border/60 glass-panel transition-shadow hover:shadow-card">
      <div className="px-3 py-2 border-b border-border/50 bg-card/80 flex items-center justify-between gap-2">
        <div className="min-w-0 flex items-center gap-2">
          <span className={cn("status-dot", !camera.enabled || camera.status === "offline" ? "status-dot-offline" : camera.status === "starting" ? "status-dot-warning" : "status-dot-online")} />
          <h3 className="text-sm font-semibold truncate">{camera.name}</h3>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isError && (
            <Badge variant="outline" title={badgeTooltip} className="text-[9px] px-1 h-4 cursor-help border-destructive/50 text-destructive">
              Error
            </Badge>
          )}
          <Badge variant="outline" className={cn("text-[10px]", streamColors[camera.streamType])}>{camera.streamType}</Badge>
          <Badge variant="outline" className={cn("text-[10px] uppercase tracking-wider", isDisabled ? "bg-muted text-muted-foreground" : statusColors[camera.status])}>
            {isDisabled ? t("inactive") : camera.status === "online" ? t("online") : camera.status === "offline" ? t("offline") : camera.status}
          </Badge>
        </div>
      </div>

      <div
        ref={cardRef}
        className={cn("relative aspect-video bg-black overflow-hidden group", !controlsVisible && "cursor-none")}
        onMouseMove={revealControls}
        onMouseEnter={revealControls}
        onMouseLeave={hideControls}
      >
        <CameraLiveView camera={camera} muted={effectiveMuted} volume={effectiveVolume} controlsVisible={controlsVisible} />
        {ptzFeedback && (
          <Badge
            variant="outline"
            className={cn(
              "absolute right-2 top-2 z-40 bg-black/65 text-[10px] backdrop-blur",
              ptzFeedback === "success" && "border-success/50 text-success",
              ptzFeedback === "warning" && "border-warning/50 text-warning",
              ptzFeedback === "failure" && "border-destructive/50 text-destructive",
              ptzFeedback === "sending" && "border-info/50 text-info",
            )}
          >
            {ptzFeedback === "sending" ? t("ptzSending")
              : ptzFeedback === "success" ? t("ptzSuccess")
                : ptzFeedback === "warning" ? t("ptzWarning")
                  : t("ptzFailed")}
          </Badge>
        )}

        <div className={cn(
          "absolute inset-x-2 bottom-2 z-40 flex items-end justify-between gap-2 transition-opacity duration-200",
          controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none",
        )}>
          <div className="pointer-events-auto">
            {ptzAvailable && (
              <div className="grid grid-cols-3 gap-1">
                <span />
                {ptzButton("up", <ArrowUp className="h-3.5 w-3.5" />, t("ptzUp"))}
                <span />
                {ptzButton("left", <ArrowLeft className="h-3.5 w-3.5" />, t("ptzLeft"))}
                <button type="button" title={t("ptzHome")} onClick={() => void sendPtz("home").catch(() => undefined)} className="h-7 w-7 rounded-md bg-black/55 text-white/90 border border-white/15 backdrop-blur-sm inline-flex items-center justify-center hover:bg-black/75">
                  <Home className="h-3.5 w-3.5" />
                </button>
                {ptzButton("right", <ArrowRight className="h-3.5 w-3.5" />, t("ptzRight"))}
                <span />
                {ptzButton("down", <ArrowDown className="h-3.5 w-3.5" />, t("ptzDown"))}
                <span />
                {ptzButton("zoomIn", <Plus className="h-3.5 w-3.5" />, t("ptzZoomIn"), "col-start-1")}
                {ptzButton("zoomOut", <Minus className="h-3.5 w-3.5" />, t("ptzZoomOut"), "col-start-3")}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 pointer-events-auto">
            {audioAvailable && (
              <div className="hidden sm:flex items-center gap-2 h-8 px-2 rounded-md bg-black/55 text-white border border-white/15">
                <input
                  aria-label="Volume"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={volumePct}
                  onChange={(e) => {
                    const pct = Math.max(0, Math.min(100, Number(e.target.value)));
                    setAudio({ volume: pct / 100, muted: pct <= 0 });
                  }}
                  className="w-20 accent-white"
                />
                <span className="w-9 text-right text-[10px] font-mono tabular-nums">{volumePct}%</span>
              </div>
            )}
            <Button
              size="icon"
              variant="secondary"
              className="h-8 w-8 bg-black/55 text-white hover:bg-black/75 border border-white/15"
              onClick={() => {
                if (!audioAvailable) return;
                setAudio((v) => {
                  if (v.muted || v.volume <= 0.02) return { muted: false, volume: v.volume > 0.02 ? v.volume : 0.5 };
                  return { ...v, muted: true };
                });
              }}
              title={!audioAvailable ? t("audioAdminOnly") : effectiveMuted ? t("unmute") : t("mute")}
              disabled={!audioAvailable}
            >
              {effectiveMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            </Button>
            <Button size="icon" variant="secondary" className="h-8 w-8 bg-black/55 text-white hover:bg-black/75 border border-white/15" onClick={toggleFullscreen} title={isFullscreen ? t("exitFullscreen") : t("fullscreen")}>
              {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      </div>

      <div className="p-3 space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3" />
              <span className="truncate">{camera.site}</span>
              <span>·</span>
              <span>{camera.brand}</span>
              {canSeeIp && <><span>·</span><span className="font-mono">{camera.ip}</span></>}
              {camera.enablePTZ && <span className="text-primary">· PTZ</span>}
              {!camera.enabled && <span className="text-warning">· Nonaktif</span>}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-2 text-[11px]">
              <span className="inline-flex items-center gap-1 text-muted-foreground"><Users className="h-3 w-3" />{camera.viewerCount || 0} viewer</span>
              <span className="inline-flex items-center gap-1 text-muted-foreground"><Gauge className="h-3 w-3" />out {outRate}</span>
              <span className="inline-flex items-center gap-1 text-muted-foreground"><Radio className="h-3 w-3" />pull {pullRate}</span>
              {camera.status === "offline" && camera.enabled && <span className="inline-flex items-center gap-1 text-muted-foreground"><Activity className="h-3 w-3" />last {timeAgo(camera.lastSeen, t)}</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-1 pt-1 -mx-2 -mb-2">
          <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full" onClick={() => onTogglePin(camera)} title={pinned ? t("unpinCamera") : t("pinCameraPriority")}>
            {pinned ? <PinOff className="h-4 w-4 text-primary" /> : <Pin className="h-4 w-4 text-muted-foreground hover:text-foreground" />}
          </Button>
          {canRestart && (
              <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full" onClick={() => onRestart(camera)} title={t("restartStream")}>
                <RefreshCw className="h-4 w-4 text-muted-foreground hover:text-info" />
              </Button>
          )}
          {canEdit && (
              <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full" onClick={() => onEdit(camera)} title={t("editCameraTitle")}>
                <Pencil className="h-4 w-4 text-muted-foreground hover:text-foreground" />
              </Button>
          )}
          {canDelete && (
            <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={() => onDelete(camera)} title={t("deleteCameraTitleLabel")}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
