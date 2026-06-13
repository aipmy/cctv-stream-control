import { useMemo } from "react";
import { useState } from "react";
import { Bell, AlertCircle, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCamerasQuery } from "@/features/cameras/queries";
import { useNavigate } from "react-router-dom";
import { streamApi } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "@/hooks/useTranslation";

export function NotificationBell() {
  const { data: cameras = [] } = useCamerasQuery();
  const { data: streamStatus = [] } = useQuery({
    queryKey: ["streamStatus"],
    queryFn: streamApi.status,
    refetchInterval: 10000,
  });
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const { t, tError, lang } = useTranslation();

  const notifications = useMemo(() => {
    const items: Array<{ id: string; type: "error" | "warning"; title: string; message: string; cameraId: string; site: string; time: number }> = [];
    
    for (const cam of cameras) {
      // Only include cameras that are currently offline and enabled
      if (cam.status !== "offline" || !cam.enabled) continue;

      // Find stream error for more detail
      const streamErr = streamStatus.find((s) => s.id === cam.id && (s.status === "error" || s.error));
      const latestHistory = cam.errorHistory?.[cam.errorHistory.length - 1];

      // Determine the offline reason — prefer stream error, fallback to error history
      const reason = streamErr?.error?.message
        || latestHistory?.message
        || "Kamera offline. Periksa koneksi jaringan dan konfigurasi kamera.";

      const timestamp = latestHistory
        ? new Date(latestHistory.timestamp).getTime()
        : Date.now();

      items.push({
        id: `offline_${cam.id}`,
        type: "error",
        title: `Offline: ${cam.name}`,
        message: tError(reason),
        cameraId: cam.id,
        site: cam.site,
        time: timestamp,
      });
    }

    return items.sort((a, b) => b.time - a.time);
  }, [cameras, streamStatus, tError]);

  const offlineCount = notifications.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {offlineCount > 0 && (
            <Badge 
              variant="destructive" 
              className="absolute -top-1 -right-1 h-4 w-4 p-0 flex items-center justify-center text-[9px] font-bold"
            >
              {offlineCount > 9 ? "9+" : offlineCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="font-semibold text-sm">{t("notifications")}</div>
          {offlineCount > 0 && (
            <Badge variant="destructive" className="text-[10px] px-1.5">{offlineCount} {lang === "id" ? "Kamera Offline" : "Offline"}</Badge>
          )}
        </div>
        
        <ScrollArea className="h-[300px]">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-6 text-center space-y-2">
              <Bell className="h-8 w-8 opacity-20" />
              <div className="text-sm">{t("noNotifications")}</div>
              <div className="text-xs opacity-70">{t("allCamerasNormal")}</div>
            </div>
          ) : (
            <div className="flex flex-col">
              {notifications.map((notif) => (
                <button
                  key={notif.id}
                  onClick={() => {
                    setOpen(false);
                    navigate(`/cameras?site=${encodeURIComponent(notif.site)}&highlight=${notif.cameraId}`);
                  }}
                  className="flex items-start gap-3 p-3 text-left hover:bg-accent/50 transition-colors border-b last:border-0"
                >
                  <div className="mt-0.5 shrink-0">
                    <AlertCircle className="h-4 w-4 text-destructive" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium leading-none mb-1">{notif.title}</div>
                    <div className="text-xs text-muted-foreground line-clamp-2">{notif.message}</div>
                    <div className="text-[10px] text-muted-foreground mt-2">
                      <span className="font-mono">{notif.site}</span>
                      <span className="mx-1">·</span>
                      <span className="font-mono">{new Date(notif.time).toLocaleTimeString("id-ID")}</span>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/30 self-center" />
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
