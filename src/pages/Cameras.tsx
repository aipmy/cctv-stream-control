import { Fragment, useEffect, useMemo, useState } from "react";
import { useCameraActions, useCamerasQuery } from "@/features/cameras/queries";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, RefreshCw, Search, Radar, Eye, EyeOff, Users, Gauge } from "lucide-react";
import { CameraFormDialog } from "@/components/CameraFormDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CameraCard } from "@/components/CameraCard";
import { useAuth } from "@/features/auth/store";
import type { Camera } from "@/types";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatByteRateFromKbps } from "@/lib/bandwidth";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSearchParams, Navigate } from "react-router-dom";
import { useTranslation } from "@/hooks/useTranslation";

export default function Cameras() {
  const camerasQuery = useCamerasQuery();
  const cameras = camerasQuery.data || [];
  const { deleteCamera, restartCamera, probeAll, probeCamera } = useCameraActions();
  const user = useAuth((s) => s.user);
  const role = user?.role;
  const perms = user?.permissions;

  const canView = role === "admin" || !!perms?.canViewManagement;
  if (!canView) {
    return <Navigate to="/" replace />;
  }
  
  const canAdd = role === "admin" || !!perms?.canAddCamera;
  const canEdit = role === "admin" || !!perms?.canEditCamera;
  const canDelete = role === "admin" || !!perms?.canDeleteCamera;
  const canRestart = role === "admin" || !!perms?.canRestartStream;
  const canSeeIp = role !== "guest";

  const [searchParams, setSearchParams] = useSearchParams();
  const [q, setQ] = useState(searchParams.get("q") || "");
  const [siteFilter, setSiteFilter] = useState(searchParams.get("site") || "all");
  const [sort, setSort] = useState("site-asc");
  const highlightId = searchParams.get("highlight");

  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Camera | null>(null);
  const [del, setDel] = useState<Camera | null>(null);
  const [restart, setRestart] = useState<Camera | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const { t, lang } = useTranslation();

  useEffect(() => {
    if (highlightId) {
      const el = document.getElementById(`cam-${highlightId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => setSearchParams(prev => {
          const next = new URLSearchParams(prev);
          next.delete("highlight");
          return next;
        }, { replace: true }), 3000);
      }
    }
  }, [highlightId, setSearchParams]);

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
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight">{t("cameraManagement")}</h1>
          <p className="text-sm text-muted-foreground">{t("camerasSubtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={async () => { 
            try { 
              await probeAll(false); 
              toast.success(t("probeFinished")); 
            } catch (err) { 
              toast.error(err instanceof Error ? err.message : t("probeFailed")); 
            } 
          }}>
            <Radar className="h-4 w-4" /> {t("checkConnection")}
          </Button>
          {canAdd && (
            <Button onClick={() => { setEdit(null); setOpen(true); }} className="bg-gradient-primary text-primary-foreground hover:opacity-95">
              <Plus className="h-4 w-4" /> {t("addCamera")}
            </Button>
          )}
        </div>
      </div>

      <Card className="grid gap-2 p-3 md:grid-cols-[minmax(240px,1fr)_200px_200px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            className="pl-9 h-9" 
            placeholder={t("searchCamera")} 
            value={q} 
            onChange={(e) => {
              setQ(e.target.value);
              if (e.target.value) searchParams.set("q", e.target.value);
              else searchParams.delete("q");
              setSearchParams(searchParams, { replace: true });
            }} 
          />
        </div>
        <Select value={siteFilter} onValueChange={(v) => {
          setSiteFilter(v);
          if (v && v !== "all") searchParams.set("site", v);
          else searchParams.delete("site");
          setSearchParams(searchParams, { replace: true });
        }}>
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allSitesOrGroups")}</SelectItem>
            {sites.map((site) => <SelectItem key={site} value={site}>{site}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="site-asc">Site A–Z</SelectItem>
            <SelectItem value="site-desc">Site Z–A</SelectItem>
            <SelectItem value="name-asc">{t("cameraName")} A–Z</SelectItem>
            <SelectItem value="name-desc">{t("cameraName")} Z–A</SelectItem>
          </SelectContent>
        </Select>
      </Card>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("cameraName")}</TableHead>
              <TableHead>Site</TableHead>
              <TableHead>Brand</TableHead>
              <TableHead>Info</TableHead>
              <TableHead>Stream</TableHead>
              <TableHead>{t("active")}</TableHead>
              <TableHead>{t("status")}</TableHead>
              <TableHead className="text-right">{t("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((c) => (
              <Fragment key={c.id}>
              <TableRow className={cn(highlightId === c.id && "bg-primary/10 border-l-2 border-l-primary")} id={`cam-${c.id}`}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell className="text-muted-foreground">{c.site}</TableCell>
                <TableCell>{c.brand}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {canSeeIp ? <div className="font-mono">{c.ip}</div> : <div className="text-muted-foreground">{t("ipHidden")}</div>}
                  <div className="flex items-center gap-3 mt-1">
                    <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{c.viewerCount || 0} {t("viewerCount").toLowerCase()}</span>
                    <span className="inline-flex items-center gap-1"><Gauge className="h-3 w-3" />out {formatByteRateFromKbps(c.bandwidthKbps || 0)}</span>
                  </div>
                </TableCell>
                <TableCell><Badge variant="outline" className="text-xs">{c.streamType}</Badge></TableCell>
                <TableCell>
                  <Badge variant={c.enabled ? "default" : "outline"} className="text-xs">
                    {c.enabled ? t("active") : t("inactive")}
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
                    <Button 
                      size="icon" 
                      variant="ghost" 
                      className="h-8 w-8" 
                      title={previewId === c.id ? t("closePreview") : t("previewStream")} 
                      onClick={() => setPreviewId((v) => v === c.id ? null : c.id)}
                    >
                      {previewId === c.id ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </Button>
                    <Button 
                      size="icon" 
                      variant="ghost" 
                      className="h-8 w-8" 
                      title={t("probeConnection")} 
                      onClick={async () => { 
                        try { 
                          await probeCamera(c.id, false); 
                          toast.success(
                            lang === "id" 
                              ? `Probe ${c.name} selesai` 
                              : `Probe ${c.name} completed`
                          ); 
                        } catch (err) { 
                          toast.error(err instanceof Error ? err.message : t("probeFailed")); 
                        } 
                      }}
                    >
                      <Radar className="h-3.5 w-3.5" />
                    </Button>
                    {canRestart && (
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setRestart(c)}>
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {canEdit && (
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setEdit(c); setOpen(true); }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
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
                    <div className="grid gap-3 md:grid-cols-[400px_1fr] items-start">
                      <CameraCard
                        camera={c}
                        onRestart={() => setRestart(c)}
                        onEdit={() => { setEdit(c); setOpen(true); }}
                        onDelete={() => setDel(c)}
                        pinned={false}
                        onTogglePin={() => {}}
                      />
                      <div className="text-xs text-muted-foreground space-y-1 pt-1">
                        <div className="font-medium text-foreground">{t("cameraManagementPreviewTitle")}</div>
                        <div>{t("cameraManagementPreviewHelp")}</div>
                        <div>Stream: <span className="font-mono">{c.streamType}</span> · HLS Mode: <span className="font-mono">{c.hlsMode || "copy"}</span> · Kualitas: <span className="font-mono">{c.streamQuality || "Auto"}</span></div>
                        <div>Audio: <span className="font-mono">{c.audioMode}</span> · PTZ: <span className="font-mono">{c.enablePTZ ? t("active") : t("inactive")}</span></div>
                        <div>Status: <span className="font-mono">{c.status}</span> · Viewer: <span className="font-mono">{c.viewerCount || 0}</span></div>
                        <div>Pull CCTV: <span className="font-mono">{formatByteRateFromKbps(c.pullBandwidthKbps || 0)}</span> · Output viewer: <span className="font-mono">{formatByteRateFromKbps(c.bandwidthKbps || 0)}</span></div>
                        {c.errorHistory && c.errorHistory.length > 0 && (
                          <div className="mt-2">
                            <div className="font-medium text-destructive">{t("lastError")}</div>
                            <div className="text-destructive/80">{tError(c.errorHistory[c.errorHistory.length - 1]?.message)}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              </Fragment>
            ))}
            {!camerasQuery.isPending && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-12">{t("noCamerasRegistered")}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <CameraFormDialog open={open} onOpenChange={setOpen} camera={edit} />
      
      <ConfirmDialog
        open={!!del} onOpenChange={(o) => !o && setDel(null)}
        title={t("deleteConfirmTitle")}
        description={t("deleteConfirmDesc", { name: del?.name || "" })}
        confirmText={t("delete")} variant="destructive"
        onConfirm={async () => { 
          if (del) { 
            try { 
              await deleteCamera(del.id); 
              toast.success(t("cameraDeleted")); 
              setDel(null); 
            } catch (err) { 
              toast.error(err instanceof Error ? err.message : t("deleteFailed")); 
            } 
          } 
        }}
      />
      
      <ConfirmDialog
        open={!!restart} onOpenChange={(o) => !o && setRestart(null)}
        title={t("restartStreamTitleShort")}
        description={t("restartStreamDescShort", { name: restart?.name || "" })}
        confirmText={t("restart")}
        onConfirm={async () => { 
          if (restart) { 
            try { 
              await restartCamera(restart.id, restart.streamType); 
              toast.success(t("streamRestartedToast")); 
              setRestart(null); 
            } catch (err) { 
              toast.error(err instanceof Error ? err.message : t("restartFailed")); 
            } 
          } 
        }}
      />
    </div>
  );
}
