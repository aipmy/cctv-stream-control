import { useEffect, useMemo, useState } from "react";
import { useCamerasQuery, useCameraActions } from "@/features/cameras/queries";
import { useSettings } from "@/features/settings/store";
import { StatCard } from "@/components/StatCard";
import { CameraCard } from "@/components/CameraCard";
import { BandwidthChart } from "@/components/BandwidthChart";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Cctv as CctvIcon, LayoutGrid, Bell, Play, ShieldAlert, Cpu, HardDrive } from "lucide-react";
import type { Camera, SmartEvent } from "@/types";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatByteRateFromKbps } from "@/lib/bandwidth";
import { useAuth } from "@/features/auth/store";
import { useTranslation } from "@/hooks/useTranslation";
import { eventApi } from "@/lib/api";
import { useNavigate } from "react-router-dom";

const formatSize = (bytes: number) => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

export default function Dashboard() {
  const navigate = useNavigate();
  const camerasQuery = useCamerasQuery();
  const cameras = camerasQuery.data || [];
  const { restartCamera, deleteCamera } = useCameraActions();
  const settings = useSettings((state) => state.settings);
  const user = useAuth((state) => state.user);
  const updatePinnedCameras = useAuth((state) => state.updatePinnedCameras);
  const [events, setEvents] = useState<SmartEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  const [storageStatus, setStorageStatus] = useState<{
    usedBytes: number;
    maxBytes: number;
    diskTotal?: number;
    diskAvailable?: number;
  } | null>(null);

  const pinnedCameraIds = user?.preferences?.pinnedCameraIds || [];
  const { t, lang } = useTranslation();
  const canViewStats = user?.role === "admin" || !!user?.permissions?.canViewStats;

  // Fetch Storage
  useEffect(() => {
    if (!canViewStats) return;
    eventApi.getStorageStatus()
      .then((data) => setStorageStatus(data))
      .catch((err) => console.error("Failed to fetch storage status", err));
  }, [canViewStats]);

  // Fetch Recent Events
  useEffect(() => {
    setLoadingEvents(true);
    eventApi.list()
      .then((data) => {
        // Sort by timestamp desc and take latest 5
        const sorted = data.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
        setEvents(sorted.slice(0, 5));
      })
      .catch((err) => console.error("Failed to fetch dashboard events", err))
      .finally(() => setLoadingEvents(false));
  }, []);

  // Filter cameras to show on Dashboard: pinned cameras, or fallback to active online cameras if nothing is pinned
  const dashboardCameras = useMemo(() => {
    if (pinnedCameraIds.length > 0) {
      return cameras.filter((c) => pinnedCameraIds.includes(c.id));
    }
    // Fallback: show first 4 online cameras
    return cameras.filter((c) => c.enabled && c.status === "online").slice(0, 4);
  }, [cameras, pinnedCameraIds]);

  const togglePin = async (camera: Camera) => {
    const next = pinnedCameraIds.includes(camera.id)
      ? pinnedCameraIds.filter((id) => id !== camera.id)
      : [...pinnedCameraIds, camera.id];
    try {
      await updatePinnedCameras(next);
      toast.success(
        next.includes(camera.id) 
          ? (lang === "id" ? `"${camera.name}" dipin` : `"${camera.name}" pinned`)
          : (lang === "id" ? `Pin "${camera.name}" dilepas` : `Pin "${camera.name}" removed`)
      );
    } catch (error) {
      toast.error(
        error instanceof Error 
          ? error.message 
          : (lang === "id" ? "Pin kamera gagal disimpan" : t("pinSaveFailed"))
      );
    }
  };

  const getEventLabel = (evt: SmartEvent) => {
    if (evt.type === "sound") return t("sound");
    switch (evt.classification) {
      case "human": return "Orang Terdeteksi";
      case "pet": return "Hewan Terdeteksi";
      case "pixel": return "Gerakan Umum";
      default: return evt.typeDescription || "Gerakan Terdeteksi";
    }
  };

  const enabled = cameras.filter((c) => c.enabled).length;
  const online = cameras.filter((c) => c.enabled && c.status === "online").length;
  const offline = cameras.filter((c) => c.enabled && c.status === "offline").length;
  const starting = cameras.filter((c) => c.enabled && c.status === "starting").length;
  const disabled = cameras.length - enabled;
  const streaming = cameras.filter((c) => c.enabled && c.status === "online" && c.viewerCount > 0).length;
  const totalViewers = cameras.reduce((a, c) => a + c.viewerCount, 0);
  const totalBw = cameras.reduce((a, c) => a + c.bandwidthKbps, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <Cpu className="h-5.5 w-5.5 text-primary" />
          {t("dashboardMonitoringTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("dashboardSubtitle")}</p>
      </div>

      {canViewStats && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label={t("totalCameras")} value={cameras.length} icon="camera" />
          <StatCard 
            label={t("camerasOnline")} 
            value={online} 
            hint={t("camerasOnlineHint", { n: Math.round((online / Math.max(enabled, 1)) * 100) })} 
            icon="online" 
            tone="success" 
          />
          <StatCard 
            label={t("camerasOffline")} 
            value={offline} 
            hint={t("camerasOfflineHint", { starting, disabled })} 
            icon="offline" 
            tone="destructive" 
          />
          <StatCard 
            label={t("camerasStreamingActive")} 
            value={streaming} 
            hint={t("camerasStreamingHint", { n: totalViewers })} 
            icon="stream" 
            tone="info" 
          />
          <StatCard label={t("cctvBandwidth")} value={formatByteRateFromKbps(totalBw)} icon="bandwidth" tone="warning" />
          <StatCard 
            label={t("diskUsage").replace(":", "")} 
            value={storageStatus ? formatSize(storageStatus.usedBytes) : "Loading..."} 
            hint={storageStatus && storageStatus.diskTotal ? `${formatSize(storageStatus.diskAvailable || 0)} bebas / ${formatSize(storageStatus.diskTotal)}` : "Loading server disk..."}
            icon="disk" 
            tone="default" 
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">
        <div className="space-y-6">
          {/* Bandwidth Usage History Graph */}
          {canViewStats && (
            <Card className="p-4 bg-card/65 backdrop-blur-sm border border-border/40 dark:border-white/5 shadow-2xl rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                <h3 className="text-xs uppercase font-bold tracking-widest text-muted-foreground">Grafik Bandwidth</h3>
              </div>
              <BandwidthChart />
            </Card>
          )}

          {/* Quick-Access Camera Streams Grid */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs uppercase font-bold tracking-widest text-muted-foreground flex items-center gap-1.5">
                <LayoutGrid className="h-4 w-4 text-primary" />
                {pinnedCameraIds.length > 0 ? "Kamera Pilihan" : "Kamera Aktif"}
              </h2>
              <Button variant="link" size="sm" onClick={() => navigate("/live")} className="text-xs text-primary px-0">
                Lihat Seluruh Kamera &rarr;
              </Button>
            </div>

            {dashboardCameras.length === 0 ? (
              <Card className="p-12 flex flex-col items-center text-center bg-card/65 border border-border/40 dark:border-white/5 rounded-xl">
                <CctvIcon className="h-10 w-10 text-muted-foreground/40 mb-3" />
                <h3 className="font-semibold">{t("noCamerasFound")}</h3>
                <p className="text-xs text-muted-foreground mt-1">{t("noCamerasSub")}</p>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {dashboardCameras.map((c) => (
                  <CameraCard
                    key={c.id} camera={c}
                    onRestart={() => {}}
                    onEdit={() => {}}
                    onDelete={() => {}}
                    pinned={pinnedCameraIds.includes(c.id)}
                    onTogglePin={(cam) => void togglePin(cam)}
                    hideManagementActions={true}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar: Recent Alert/Events Feed */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs uppercase font-bold tracking-widest text-muted-foreground flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary" />
              Notifikasi Baru
            </h2>
            <Button variant="link" size="sm" onClick={() => navigate("/events")} className="text-xs text-primary px-0">
              Semua Event &rarr;
            </Button>
          </div>

          <Card className="p-4 bg-card/65 backdrop-blur-sm border border-border/40 dark:border-white/5 shadow-2xl rounded-xl flex flex-col h-[520px] overflow-hidden">
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {loadingEvents ? (
                <div className="flex flex-col items-center justify-center py-20 gap-2">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  <span className="text-xs text-muted-foreground">{t("loading")}</span>
                </div>
              ) : events.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground gap-2">
                  <ShieldAlert className="h-8 w-8 text-muted-foreground/40" />
                  <span className="text-xs">Tidak ada kejadian terekam.</span>
                </div>
              ) : (
                events.map((evt) => {
                  const isHuman = evt.classification === "human";
                  const isPet = evt.classification === "pet";
                  const isPixel = evt.classification === "pixel";
                  
                  return (
                    <div 
                      key={evt.id} 
                      className="group flex gap-3 pb-3.5 border-b border-border/30 dark:border-white/5 last:border-0 last:pb-0 items-start cursor-pointer hover:bg-muted/10 p-1 rounded transition-colors"
                      onClick={() => navigate(`/playback?camera=${evt.cameraId}&ts=${evt.ts}`)}
                    >
                      {/* Event Snapshot Thumbnail */}
                      <div className="w-16 h-10 bg-muted/40 rounded-lg overflow-hidden shrink-0 border relative">
                        <img 
                          src={eventApi.snapshotUrl(evt.id)} 
                          alt="Snapshot"
                          loading="lazy"
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = "none";
                          }}
                        />
                        <div className="absolute inset-0 bg-black/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <Play className="h-3 w-3 text-white fill-current" />
                        </div>
                      </div>

                      {/* Text info and glowing dot */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 justify-between">
                          <span className="font-semibold text-xs text-foreground truncate">{evt.cameraName}</span>
                          <span className={cn(
                            "h-2 w-2 rounded-full shrink-0",
                            isHuman 
                              ? "bg-rose-500 shadow-[0_0_8px_#f43f5e]" 
                              : isPet 
                                ? "bg-emerald-500 shadow-[0_0_8px_#10b981]" 
                                : isPixel 
                                  ? "bg-blue-500 shadow-[0_0_8px_#3b82f6]" 
                                  : "bg-amber-500 shadow-[0_0_8px_#f59e0b]"
                          )} />
                        </div>
                        <div className="text-[10px] text-muted-foreground font-medium mt-0.5">{getEventLabel(evt)}</div>
                        <div className="text-[9px] text-muted-foreground/80 mt-1 font-mono">
                          {new Date(evt.ts).toLocaleTimeString("id-ID", { hour12: false })}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// Simulated loader component since we didn't import it directly
function Loader2({ className }: { className?: string }) {
  return (
    <div className={cn("animate-spin rounded-full border-2 border-primary border-t-transparent", className)} style={{ width: "24px", height: "24px" }} />
  );
}
