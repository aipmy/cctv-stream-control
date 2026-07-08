import React, { useMemo } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { usePlayback } from "../context/PlaybackContext";
import { useCamerasQuery } from "@/features/cameras/queries";
import { useSettings } from "@/features/settings/store";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronsUpDown, Search, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";

export function PlaybackControls() {
  const { t } = useTranslation();
  const theme = useSettings((s) => s.theme);
  const { data: cameras = [] } = useCamerasQuery();

  const {
    selectedCameraId, setSelectedCameraId,
    selectedDate, setSelectedDate,
    cameraSearchQuery, setCameraSearchQuery,
    isCameraPopoverOpen, setIsCameraPopoverOpen,
    playbackWindowMinutes, setPlaybackWindowMinutes,
    currentPlaybackTs, setPlaybackWindowCenterTs,
    setActivePosterUrl, playbackInfo
  } = usePlayback();

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

  const formatBytes = (bytes?: number) => {
    if (bytes === undefined || bytes === null || isNaN(bytes)) return "0 B";
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <Card className="p-5 border border-border/40 bg-card/65 backdrop-blur-md shadow-sm">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 items-end">
        <div className="space-y-1">
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("selectCamera")}</Label>
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
                          setActivePosterUrl(null);
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
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("selectDate")}</Label>
          <div className="relative">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                setActivePosterUrl(null);
              }}
              className="w-full h-10 pl-10 pr-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer relative block appearance-none"
              style={{
                colorScheme: theme === "dark" ? "dark" : "light",
                boxSizing: "border-box"
              }}
            />
            <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60 pointer-events-none" />
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("loadWindowLimit")}</Label>
          <Select 
            value={playbackWindowMinutes} 
            onValueChange={(val) => {
              setPlaybackWindowMinutes(val);
              if (val !== "none") {
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
        </div>

        <div className="h-10 flex items-center justify-between px-3 bg-muted/20 border border-border/40 rounded-md">
          <span className="text-xs text-muted-foreground font-medium">{t("diskUsage")}</span>
          <span className="font-semibold text-foreground text-xs font-mono bg-slate-900 border border-border/45 px-1.5 py-0.5 rounded">
            {selectedCameraId && playbackInfo ? formatBytes(playbackInfo.diskUsageBytes) : "-- B"}
          </span>
        </div>
      </div>
    </Card>
  );
}
