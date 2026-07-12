import React, { useEffect, useRef } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { usePlayback } from "../context/PlaybackContext";
import { playbackUrl, downloadUrl } from "@/lib/api";
import { useCamerasQuery } from "@/features/cameras/queries";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Download } from "lucide-react";
import { toast } from "sonner";

export function DownloadClipForm() {
  const { t } = useTranslation();
  const { data: cameras = [] } = useCamerasQuery();

  const {
    selectedCameraIds, selectedDate, playbackInfoMap,
    downloadStart, setDownloadStart,
    downloadEnd, setDownloadEnd,
    previewStartTs, setPreviewStartTs,
    previewEndTs, setPreviewEndTs,
    isPreviewDownloadOpen, setIsPreviewDownloadOpen
  } = usePlayback();

  const selectedCameraId = selectedCameraIds.length === 1 ? selectedCameraIds[0] : null;
  const playbackInfo = selectedCameraId ? playbackInfoMap[selectedCameraId] : null;

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
          if (!disposed) video.play().catch(() => {});
        };
        return;
      }

      try {
        const mod = await import("hls.js");
        const Hls = mod.default;
        if (!Hls.isSupported()) return;

        const hls = new Hls({ maxBufferLength: 10 });
        previewHlsRef.current = hls;
        hls.loadSource(previewSrc);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (!disposed) video.play().catch(() => {});
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

  return (
    <>
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
                className="w-full px-3 py-1.5 rounded-md border border-border/60 bg-background text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">{t("endTime")}</Label>
              <input
                type="text"
                placeholder="12:05"
                value={downloadEnd}
                onChange={(e) => setDownloadEnd(e.target.value.replace(/[^0-9:]/g, ""))}
                className="w-full px-3 py-1.5 rounded-md border border-border/60 bg-background text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <Button onClick={handleDownload} className="col-span-2 md:col-span-1">
              <Download className="h-4 w-4 mr-2" />
              {t("startExport")}
            </Button>
          </div>
        </Card>
      )}

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
            <div>{t("cameraName")}: <span className="text-foreground font-semibold">{cameras.find((c: any) => c.id === selectedCameraId)?.name}</span></div>
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
            <Button size="sm" onClick={triggerDownloadMp4} className="bg-gradient-primary text-white border-0">
              <Download className="h-4 w-4 mr-1.5" />
              {t("downloadMp4")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
