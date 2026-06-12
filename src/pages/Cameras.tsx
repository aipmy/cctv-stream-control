import { Fragment, useMemo, useState } from "react";
import { useCameraActions, useCamerasQuery } from "@/features/cameras/queries";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, RefreshCw, Search, Radar, Eye, EyeOff, Users, Gauge } from "lucide-react";
import { CameraFormDialog } from "@/components/CameraFormDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CameraLiveView } from "@/components/CameraLiveView";
import { useAuth } from "@/features/auth/store";
import type { Camera } from "@/types";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatByteRateFromKbps } from "@/lib/bandwidth";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function Cameras() {
  const camerasQuery = useCamerasQuery();
  const cameras = camerasQuery.data || [];
  const { deleteCamera, restartCamera, probeAll, probeCamera } = useCameraActions();
  const role = useAuth((s) => s.user?.role);
  const canEdit = role === "admin" || role === "teknisi";
  const canDelete = role === "admin";
  const canSeeIp = role !== "guest";

  const [q, setQ] = useState("");
  const [siteFilter, setSiteFilter] = useState("all");
  const [sort, setSort] = useState("site-asc");
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Camera | null>(null);
  const [del, setDel] = useState<Camera | null>(null);
  const [restart, setRestart] = useState<Camera | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const sites = useMemo(
    () => [...new Set(cameras.map((camera) => camera.site).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [cameras],
  );

  const filtered = useMemo(() => {
    return cameras
      .filter((c) => !q || `${c.name} ${c.site} ${c.ip} ${c.brand}`.toLowerCase().includes(q.toLowerCase()))
      .filter((c) => siteFilter === "all" || c.site === siteFilter)
      .sort((a, b) => {
        if (sort === "site-desc") return b.site.localeCompare(a.site) || b.name.localeCompare(a.name);
        if (sort === "name-asc") return a.name.localeCompare(b.name);
        if (sort === "name-desc") return b.name.localeCompare(a.name);
        return a.site.localeCompare(b.site) || a.name.localeCompare(b.name);
      });
  }, [cameras, q, siteFilter, sort]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Manajemen Kamera</h1>
          <p className="text-sm text-muted-foreground">Daftar lengkap perangkat CCTV terdaftar.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={async () => { try { await probeAll(false); toast.success("Probe koneksi selesai"); } catch (err) { toast.error(err instanceof Error ? err.message : "Probe gagal"); } }}>
            <Radar className="h-4 w-4" /> Cek Koneksi
          </Button>
          {canEdit && (
            <Button onClick={() => { setEdit(null); setOpen(true); }} className="bg-gradient-primary text-primary-foreground hover:opacity-95">
              <Plus className="h-4 w-4" /> Tambah Kamera
            </Button>
          )}
        </div>
      </div>

      <Card className="grid gap-2 p-3 md:grid-cols-[minmax(240px,1fr)_200px_200px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9 h-9" placeholder="Cari kamera…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={siteFilter} onValueChange={setSiteFilter}>
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Site / Group</SelectItem>
            {sites.map((site) => <SelectItem key={site} value={site}>{site}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="site-asc">Site A–Z</SelectItem>
            <SelectItem value="site-desc">Site Z–A</SelectItem>
            <SelectItem value="name-asc">Nama A–Z</SelectItem>
            <SelectItem value="name-desc">Nama Z–A</SelectItem>
          </SelectContent>
        </Select>
      </Card>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nama</TableHead>
              <TableHead>Site</TableHead>
              <TableHead>Brand</TableHead>
              <TableHead>Info</TableHead>
              <TableHead>Stream</TableHead>
              <TableHead>Aktif</TableHead>
              <TableHead>Status Otomatis</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((c) => (
              <Fragment key={c.id}>
              <TableRow>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell className="text-muted-foreground">{c.site}</TableCell>
                <TableCell>{c.brand}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {canSeeIp ? <div className="font-mono">{c.ip}</div> : <div className="text-muted-foreground">IP disembunyikan</div>}
                  <div className="flex items-center gap-3 mt-1">
                    <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{c.viewerCount || 0} viewer</span>
                    <span className="inline-flex items-center gap-1"><Gauge className="h-3 w-3" />out {formatByteRateFromKbps(c.bandwidthKbps || 0)}</span>
                  </div>
                </TableCell>
                <TableCell><Badge variant="outline" className="text-xs">{c.streamType}</Badge></TableCell>
                <TableCell>
                  <Badge variant={c.enabled ? "default" : "outline"} className="text-xs">
                    {c.enabled ? "Aktif" : "Nonaktif"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <span className={cn("status-dot", !c.enabled || c.status === "offline" ? "status-dot-offline" : c.status === "starting" ? "status-dot-warning" : "status-dot-online")} />
                    <span className="text-xs capitalize">{!c.enabled ? "disabled" : c.status}</span>
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {canEdit && (
                      <>
                        <Button size="icon" variant="ghost" className="h-8 w-8" title={previewId === c.id ? "Tutup preview" : "Preview stream"} onClick={() => setPreviewId((v) => v === c.id ? null : c.id)}>
                          {previewId === c.id ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" title="Probe koneksi" onClick={async () => { try { await probeCamera(c.id, false); toast.success(`Probe ${c.name} selesai`); } catch (err) { toast.error(err instanceof Error ? err.message : "Probe gagal"); } }}>
                          <Radar className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setRestart(c)}>
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setEdit(c); setOpen(true); }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                    {canDelete && (
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDel(c)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
              {previewId === c.id && (
                <TableRow>
                  <TableCell colSpan={8} className="bg-muted/15 p-3">
                    <div className="grid gap-3 md:grid-cols-[360px_1fr] items-start">
                      <div className="relative aspect-video overflow-hidden rounded-lg border bg-black">
                        <CameraLiveView camera={c} muted volume={0} />
                      </div>
                      <div className="text-xs text-muted-foreground space-y-1 pt-1">
                        <div className="font-medium text-foreground">Preview Manajemen Kamera</div>
                        <div>Preview ini hanya aktif saat tombol mata dibuka. Tutup preview agar FFmpeg idle dan berhenti otomatis.</div>
                        <div>Stream: <span className="font-mono">{c.streamType}</span> · Status: <span className="font-mono">{c.status}</span> · Viewer: <span className="font-mono">{c.viewerCount || 0}</span></div>
                        <div>Pull CCTV: <span className="font-mono">{formatByteRateFromKbps(c.pullBandwidthKbps || 0)}</span> · Output viewer: <span className="font-mono">{formatByteRateFromKbps(c.bandwidthKbps || 0)}</span></div>
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              </Fragment>
            ))}
            {!camerasQuery.isPending && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-12">Belum ada kamera.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <CameraFormDialog open={open} onOpenChange={setOpen} camera={edit} />
      <ConfirmDialog
        open={!!del} onOpenChange={(o) => !o && setDel(null)}
        title="Hapus kamera?"
        description={`"${del?.name}" akan dihapus permanen.`}
        confirmText="Hapus" variant="destructive"
        onConfirm={async () => { if (del) { try { await deleteCamera(del.id); toast.success("Kamera dihapus"); setDel(null); } catch (err) { toast.error(err instanceof Error ? err.message : "Gagal menghapus kamera"); } } }}
      />
      <ConfirmDialog
        open={!!restart} onOpenChange={(o) => !o && setRestart(null)}
        title="Restart stream?"
        description={`Stream "${restart?.name}" akan di-restart.`}
        confirmText="Restart"
        onConfirm={async () => { if (restart) { try { await restartCamera(restart.id, restart.streamType); toast.success("Stream di-restart"); setRestart(null); } catch (err) { toast.error(err instanceof Error ? err.message : "Gagal restart stream"); } } }}
      />
    </div>
  );
}
