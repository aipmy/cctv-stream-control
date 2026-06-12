import { useEffect, useMemo, useState } from "react";
import { useCamerasQuery, useCameraActions } from "@/features/cameras/queries";
import { useSettings } from "@/features/settings/store";
import { StatCard } from "@/components/StatCard";
import { CameraCard } from "@/components/CameraCard";
import { CameraFormDialog } from "@/components/CameraFormDialog";
import { BandwidthChart } from "@/components/BandwidthChart";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Search, CctvIcon, Radar, Pin, LayoutGrid } from "lucide-react";
import type { Camera } from "@/types";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatByteRateFromKbps } from "@/lib/bandwidth";
import { useAuth } from "@/features/auth/store";
import { filterDashboardCameras, gridClassFor, paginateCameras } from "@/features/cameras/dashboardView";

export default function Dashboard() {
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
  const [page, setPage] = useState(1);

  const [editCam, setEditCam] = useState<Camera | null>(null);
  const [deleteCam, setDeleteCam] = useState<Camera | null>(null);
  const [restartCam, setRestartCam] = useState<Camera | null>(null);

  const sites = useMemo(() => Array.from(new Set(cameras.map((c) => c.site))).sort(), [cameras]);
  const pinnedCameraIds = user?.preferences?.pinnedCameraIds || [];

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

  const enabled = cameras.filter((c) => c.enabled).length;
  const disabled = cameras.length - enabled;
  const online = cameras.filter((c) => c.enabled && c.status === "online").length;
  const offline = cameras.filter((c) => c.enabled && c.status === "offline").length;
  const starting = cameras.filter((c) => c.enabled && c.status === "starting").length;
  const streaming = cameras.filter((c) => c.enabled && c.status === "online" && c.viewerCount > 0).length;
  const totalViewers = cameras.reduce((a, c) => a + c.viewerCount, 0);
  const totalBw = cameras.reduce((a, c) => a + c.bandwidthKbps, 0);

  const gridCls = gridClassFor(settings.gridCols);

  const togglePin = async (camera: Camera) => {
    const next = pinnedCameraIds.includes(camera.id)
      ? pinnedCameraIds.filter((id) => id !== camera.id)
      : [...pinnedCameraIds, camera.id];
    try {
      await updatePinnedCameras(next);
      toast.success(next.includes(camera.id) ? `"${camera.name}" dipin` : `Pin "${camera.name}" dilepas`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Pin kamera gagal disimpan");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Dashboard Monitoring</h1>
        <p className="text-sm text-muted-foreground">Ringkasan status dan live stream seluruh kamera CCTV.</p>
        {camerasQuery.isError && (
          <p className="text-xs text-destructive mt-1">
            Gagal memuat kamera: {camerasQuery.error instanceof Error ? camerasQuery.error.message : "Backend tidak tersedia"}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard label="Total Kamera" value={cameras.length} icon="camera" />
        <StatCard label="Online" value={online} hint={`${Math.round((online / Math.max(enabled, 1)) * 100)}% dari aktif`} icon="online" tone="success" />
        <StatCard label="Offline" value={offline} hint={`${starting} starting · ${disabled} nonaktif`} icon="offline" tone="destructive" />
        <StatCard label="Streaming Aktif" value={streaming} hint={`${totalViewers} viewer total`} icon="stream" tone="info" />
        <StatCard label="CCTV Keluar" value={formatByteRateFromKbps(totalBw)} icon="bandwidth" tone="warning" />
      </div>

      <BandwidthChart />



      <Card className="p-3 flex flex-col gap-2">
        <div className="flex flex-col md:flex-row gap-2 items-stretch md:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama, lokasi, group, brand, IP, atau status…" className="pl-9 h-9" />
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="h-9 px-3 rounded-md border text-xs inline-flex items-center justify-center gap-1.5 hover:bg-muted" onClick={async () => { try { await probeAll(false); toast.success("Probe koneksi selesai"); } catch (err) { toast.error(err instanceof Error ? err.message : "Probe gagal"); } }}>
            <Radar className="h-3.5 w-3.5" /> Probe
          </button>
          <Button
            type="button"
            variant={pinnedOnly ? "default" : "outline"}
            size="sm"
            className="h-9"
            onClick={() => setPinnedOnly((value) => !value)}
          >
            <Pin className="h-3.5 w-3.5" />
            {pinnedOnly ? "Hanya Pin" : `Pin (${pinnedCameraIds.length})`}
          </Button>
          <Select value={site} onValueChange={setSite}>
            <SelectTrigger className="h-9 md:w-40"><SelectValue placeholder="Site" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Site</SelectItem>
              {sites.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9 md:w-36"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Status</SelectItem>
              <SelectItem value="enabled">Kamera Aktif</SelectItem>
              <SelectItem value="disabled">Kamera Nonaktif</SelectItem>
              <SelectItem value="online">Online</SelectItem>
              <SelectItem value="starting">Starting</SelectItem>
              <SelectItem value="offline">Offline</SelectItem>
            </SelectContent>
          </Select>
          <Select value={stream} onValueChange={setStream}>
            <SelectTrigger className="h-9 md:w-44"><SelectValue placeholder="Stream" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Stream</SelectItem>
              <SelectItem value="HLS Stable">HLS Stable</SelectItem>
              <SelectItem value="HLS Low Latency">HLS Low Latency</SelectItem>
              <SelectItem value="MJPEG">MJPEG</SelectItem>
            </SelectContent>
          </Select>
        </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <LayoutGrid className="h-3.5 w-3.5" />
            <span>Grid</span>
            <Select value={String(settings.gridCols)} onValueChange={(value) => setSettings({ gridCols: Number(value) as 1 | 2 | 3 | 4 | 5 | 6 })}>
              <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5, 6].map((value) => <SelectItem key={value} value={String(value)}>{value}</SelectItem>)}
              </SelectContent>
            </Select>
            <span>Per halaman</span>
            <Select value={String(settings.pageSize)} onValueChange={(value) => setSettings({ pageSize: Number(value) as 1 | 2 | 3 | 4 | 5 | 6 })}>
              <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5, 6].map((value) => <SelectItem key={value} value={String(value)}>{value}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="text-xs text-muted-foreground">
            {filtered.length} kamera ditemukan
          </div>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card className="p-12 flex flex-col items-center text-center">
          <CctvIcon className="h-10 w-10 text-muted-foreground/50 mb-3" />
          <h3 className="font-medium">Tidak ada kamera ditemukan</h3>
          <p className="text-sm text-muted-foreground mt-1">Coba ubah filter atau kata kunci pencarian.</p>
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
            />
          ))}
        </div>
      )}

      {filtered.length > 0 && pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={pagination.page <= 1} onClick={() => setPage((value) => value - 1)}>
            Sebelumnya
          </Button>
          <span className="text-xs text-muted-foreground">
            Halaman {pagination.page} dari {pagination.totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={pagination.page >= pagination.totalPages} onClick={() => setPage((value) => value + 1)}>
            Berikutnya
          </Button>
        </div>
      )}

      <CameraFormDialog open={!!editCam} onOpenChange={(o) => !o && setEditCam(null)} camera={editCam} />

      <ConfirmDialog
        open={!!restartCam}
        onOpenChange={(o) => !o && setRestartCam(null)}
        title="Restart stream kamera?"
        description={`Stream untuk "${restartCam?.name}" akan di-restart. Viewer aktif akan terputus sementara.`}
        confirmText="Restart"
        onConfirm={async () => { if (restartCam) { try { await restartCamera(restartCam.id, restartCam.streamType); toast.success(`Stream "${restartCam.name}" di-restart`); setRestartCam(null); } catch (err) { toast.error(err instanceof Error ? err.message : "Gagal restart stream"); } } }}
      />
      <ConfirmDialog
        open={!!deleteCam}
        onOpenChange={(o) => !o && setDeleteCam(null)}
        title="Hapus kamera ini?"
        description={`Kamera "${deleteCam?.name}" akan dihapus permanen dari sistem.`}
        confirmText="Hapus"
        variant="destructive"
        onConfirm={async () => { if (deleteCam) { try { await deleteCamera(deleteCam.id); toast.success("Kamera dihapus"); setDeleteCam(null); } catch (err) { toast.error(err instanceof Error ? err.message : "Gagal menghapus kamera"); } } }}
      />
    </div>
  );
}
