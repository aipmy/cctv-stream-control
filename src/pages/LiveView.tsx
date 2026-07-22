import { useEffect, useMemo, useState } from "react";
import { useCamerasQuery, useCameraActions } from "@/features/cameras/queries";
import { useSettings } from "@/features/settings/store";
import { CameraCard } from "@/components/CameraCard";
import { CameraFormDialog } from "@/components/CameraFormDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Search, Cctv as CctvIcon, Radar, Pin, LayoutGrid, MonitorPlay, ChevronLeft, ChevronRight } from "lucide-react";
import type { Camera } from "@/types";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/store";
import { filterDashboardCameras, gridClassFor, paginateCameras } from "@/features/cameras/dashboardView";
import { useTranslation } from "@/hooks/useTranslation";

export default function LiveView() {
  const camerasQuery = useCamerasQuery();
  const cameras = camerasQuery.data || [];
  const { restartCamera, deleteCamera, probeAll } = useCameraActions();
  const settings = useSettings((state) => state.settings);
  const setSettings = useSettings((state) => state.setSettings);
  const user = useAuth((state) => state.user);
  const updatePinnedCameras = useAuth((state) => state.updatePinnedCameras);
  const [q, setQ] = useState("");
  const [site, setSite] = useState("all");
  const [status, setStatus] = useState("all");
  const [stream, setStream] = useState("all");
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [isCompact, setIsCompact] = useState(false);
  const [page, setPage] = useState(1);

  const [editCam, setEditCam] = useState<Camera | null>(null);
  const [deleteCam, setDeleteCam] = useState<Camera | null>(null);
  const [restartCam, setRestartCam] = useState<Camera | null>(null);

  const sites = useMemo(() => Array.from(new Set(cameras.map((c) => c.site))).sort(), [cameras]);
  const pinnedCameraIds = user?.preferences?.pinnedCameraIds || [];
  
  const { t, lang } = useTranslation();

  const filtered = useMemo(() => {
    return filterDashboardCameras(cameras, {
      query: q,
      site,
      status,
      stream,
      pinnedOnly,
      pinnedCameraIds,
    })
      .sort((a, b) => a.site.localeCompare(b.site) || a.name.localeCompare(b.name));
  }, [cameras, pinnedCameraIds, pinnedOnly, q, site, status, stream]);
  
  const pagination = useMemo(
    () => paginateCameras(filtered, page, settings.pageSize),
    [filtered, page, settings.pageSize],
  );

  useEffect(() => {
    setPage(1);
  }, [q, site, status, stream, pinnedOnly, settings.pageSize]);

  useEffect(() => {
    if (page !== pagination.page) setPage(pagination.page);
  }, [page, pagination.page]);

  useEffect(() => {
    if (!user || camerasQuery.isPending) return;
    const validIds = new Set(cameras.map((camera) => camera.id));
    const cleaned = pinnedCameraIds.filter((id) => validIds.has(id));
    if (cleaned.length !== pinnedCameraIds.length) {
      void updatePinnedCameras(cleaned).catch(() => undefined);
    }
  }, [cameras, camerasQuery.isPending, pinnedCameraIds, updatePinnedCameras, user]);

  const gridCls = gridClassFor(settings.gridCols);

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

  return (
    <div className={cn("space-y-6", isCompact && "space-y-3")}>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <MonitorPlay className="h-5.5 w-5.5 text-primary" />
            {lang === "id" ? "Pemantauan Langsung" : "Live View Grid"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {lang === "id" ? "Pantau semua stream kamera langsung secara real-time." : "Monitor all live camera streams in real-time."}
          </p>
        </div>
      </div>

      <Card className="p-3 flex flex-col gap-2 bg-card/65 backdrop-blur-sm border border-border/40 dark:border-white/5 shadow-2xl rounded-xl">
        <div className="flex flex-col md:flex-row gap-2 items-stretch md:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              value={q} 
              onChange={(e) => setQ(e.target.value)} 
              placeholder={t("searchPlaceholder")} 
              className="pl-9 h-9 bg-background/40 border-border/40" 
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={pinnedOnly ? "default" : "outline"}
              size="sm"
              className="h-9 border-border/40"
              onClick={() => setPinnedOnly((value) => !value)}
            >
              <Pin className="h-3.5 w-3.5 mr-1" />
              {pinnedOnly ? t("pinnedOnly") : t("pinnedCount", { n: pinnedCameraIds.length })}
            </Button>
            <Select value={site} onValueChange={setSite}>
              <SelectTrigger className="h-9 md:w-40 bg-background/40 border-border/40"><SelectValue placeholder="Site" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allSites")}</SelectItem>
                {sites.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9 md:w-36 bg-background/40 border-border/40"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allStatuses")}</SelectItem>
                <SelectItem value="enabled">{t("cameraActive")}</SelectItem>
                <SelectItem value="disabled">{t("cameraInactive")}</SelectItem>
                <SelectItem value="online">{t("online")}</SelectItem>
                <SelectItem value="starting">Starting</SelectItem>
                <SelectItem value="offline">{t("offline")}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={stream} onValueChange={setStream}>
              <SelectTrigger className="h-9 md:w-44 bg-background/40 border-border/40"><SelectValue placeholder="Stream" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allStreams")}</SelectItem>
                <SelectItem value="HLS Stable">HLS Stable</SelectItem>
                <SelectItem value="HLS Low Latency">HLS Low Latency</SelectItem>
                <SelectItem value="MJPEG">MJPEG</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/40 dark:border-white/5 pt-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <LayoutGrid className="h-3.5 w-3.5 text-primary" />
            <span>{t("grid")}</span>
            <Select value={String(settings.gridCols)} onValueChange={(value) => setSettings({ gridCols: Number(value) as 1 | 2 | 3 | 4 | 5 | 6 })}>
              <SelectTrigger className="h-8 w-20 bg-background/40 border-border/40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5, 6].map((value) => <SelectItem key={value} value={String(value)}>{value}</SelectItem>)}
              </SelectContent>
            </Select>
            <span>{t("perPage")}</span>
            <Select value={String(settings.pageSize)} onValueChange={(value) => setSettings({ pageSize: Number(value) as 1 | 2 | 3 | 4 | 5 | 6 })}>
              <SelectTrigger className="h-8 w-20 bg-background/40 border-border/40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5, 6].map((value) => <SelectItem key={value} value={String(value)}>{value}</SelectItem>)}
              </SelectContent>
            </Select>

            <Button
              type="button"
              variant={isCompact ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs gap-1 border-border/40 font-medium ml-1"
              onClick={() => setIsCompact(!isCompact)}
              title="Toggle Compact Video Wall Mode"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              {isCompact ? (lang === "id" ? "Mode Compact: On" : "Compact: On") : (lang === "id" ? "Mode Compact: Off" : "Compact: Off")}
            </Button>
          </div>
          <div className="text-xs text-muted-foreground font-semibold">
            {t("camerasFoundCount", { n: filtered.length })}
          </div>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card className="p-16 flex flex-col items-center text-center bg-card/65 border border-border/40 dark:border-white/5 rounded-xl shadow-xl">
          <CctvIcon className="h-10 w-10 text-muted-foreground/50 mb-3" />
          <h3 className="font-semibold text-foreground">{t("noCamerasFound")}</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs">{t("noCamerasSub")}</p>
        </Card>
      ) : (
        <div className={cn("grid grid-cols-1 gap-4", gridCls)}>
          {pagination.items.map((c) => (
            <CameraCard
              key={c.id} camera={c}
              onRestart={(cam) => setRestartCam(cam)}
              onEdit={(cam) => setEditCam(cam)}
              onDelete={(cam) => setDeleteCam(cam)}
              pinned={pinnedCameraIds.includes(c.id)}
              onTogglePin={(cam) => void togglePin(cam)}
              hideManagementActions={true}
              compact={isCompact}
            />
          ))}
        </div>
      )}

      {filtered.length > 0 && pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          <Button variant="outline" size="sm" className="border-border/40" disabled={pagination.page <= 1} onClick={() => setPage((value) => value - 1)}>
            <ChevronLeft className="h-4 w-4 mr-1" /> {t("prev")}
          </Button>
          <span className="text-xs text-muted-foreground font-semibold">
            {t("pageOf", { page: pagination.page, totalPages: pagination.totalPages })}
          </span>
          <Button variant="outline" size="sm" className="border-border/40" disabled={pagination.page >= pagination.totalPages} onClick={() => setPage((value) => value + 1)}>
            {t("next")} <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}

      <CameraFormDialog open={!!editCam} onOpenChange={(o) => !o && setEditCam(null)} camera={editCam} />

      <ConfirmDialog
        open={!!restartCam}
        onOpenChange={(o) => !o && setRestartCam(null)}
        title={t("restartStreamTitle")}
        description={t("restartStreamDesc", { name: restartCam?.name || "" })}
        confirmText={t("restart")}
        onConfirm={async () => { 
          if (restartCam) { 
            try { 
              await restartCamera(restartCam.id, restartCam.streamType); 
              toast.success(
                lang === "id" 
                  ? `Stream "${restartCam.name}" di-restart` 
                  : `Stream "${restartCam.name}" restarted`
              ); 
              setRestartCam(null); 
            } catch (err) { 
              toast.error(err instanceof Error ? err.message : t("restartFailed")); 
            } 
          } 
        }}
      />
      <ConfirmDialog
        open={!!deleteCam}
        onOpenChange={(o) => !o && setDeleteCam(null)}
        title={t("deleteCameraTitle")}
        description={t("deleteCameraDesc", { name: deleteCam?.name || "" })}
        confirmText={t("delete")}
        variant="destructive"
        onConfirm={async () => { 
          if (deleteCam) { 
            try { 
              await deleteCamera(deleteCam.id); 
              toast.success(t("cameraDeleted")); 
              setDeleteCam(null); 
            } catch (err) { 
              toast.error(err instanceof Error ? err.message : t("deleteFailed")); 
            } 
          } 
        }}
      />
    </div>
  );
}
