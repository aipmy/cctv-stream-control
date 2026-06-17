import { useMemo, useEffect, useState } from "react";
import { Bell, AlertCircle, ChevronRight, ShieldAlert, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCamerasQuery } from "@/features/cameras/queries";
import { useNavigate } from "react-router-dom";
import { streamApi, eventApi } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "@/hooks/useTranslation";
import { toast } from "sonner";

export function NotificationBell() {
  const { data: cameras = [] } = useCamerasQuery();
  const { data: streamStatus = [] } = useQuery({
    queryKey: ["streamStatus"],
    queryFn: streamApi.status,
    refetchInterval: 10000,
  });
  const { data: events = [] } = useQuery({
    queryKey: ["smartEvents"],
    queryFn: eventApi.list,
    refetchInterval: 5000,
  });
  
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { t, tError, lang } = useTranslation();

  // Track seen event IDs to prevent duplicate toasts
  const [seenEventIds, setSeenEventIds] = useState<Set<string>>(() => new Set());
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  useEffect(() => {
    if (events.length === 0) return;

    if (isInitialLoad) {
      setSeenEventIds(new Set(events.map(e => e.id)));
      setIsInitialLoad(false);
      return;
    }

    events.forEach(evt => {
      if (!seenEventIds.has(evt.id)) {
        const elapsed = Date.now() - new Date(evt.ts).getTime();
        if (elapsed < 15000) {
          const typeLabel = evt.type === "motion" ? t("motion") : t("sound");
          const emoji = evt.type === "motion" ? "🏃" : "🔊";
          toast.warning(`${emoji} ${evt.cameraName} - ${typeLabel} Terdeteksi!`, {
            description: `${evt.site} · ${new Date(evt.ts).toLocaleTimeString("id-ID", { hour12: false })}`,
            action: {
              label: lang === "id" ? "Lihat" : "View",
              onClick: () => navigate("/events"),
            },
          });
        }
        setSeenEventIds(prev => {
          const next = new Set(prev);
          next.add(evt.id);
          return next;
        });
      }
    });
  }, [events, isInitialLoad, seenEventIds, navigate, t, lang]);

  const notifications = useMemo(() => {
    const items: Array<{
      id: string;
      type: "error" | "warning";
      title: string;
      message: string;
      cameraId?: string;
      site: string;
      time: number;
      icon: React.ReactNode;
    }> = [];
    
    for (const cam of cameras) {
      if (cam.status !== "offline" || !cam.enabled) continue;

      const streamErr = streamStatus.find((s) => s.id === cam.id && (s.status === "error" || s.error));
      const latestHistory = cam.errorHistory?.[cam.errorHistory.length - 1];

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
        icon: <AlertCircle className="h-4 w-4 text-destructive" />,
      });
    }

    // Add smart events to notifications (show latest 10 events)
    events.slice(0, 10).forEach(evt => {
      const typeLabel = evt.type === "motion" ? t("motion") : t("sound");
      items.push({
        id: `event_${evt.id}`,
        type: "warning",
        title: `${evt.cameraName} - ${typeLabel}`,
        message: evt.type === "motion" 
          ? `${t("motion")} terdeteksi di site ${evt.site}.` 
          : `${t("sound")} terdeteksi di site ${evt.site}.`,
        site: evt.site,
        time: new Date(evt.ts).getTime(),
        icon: evt.type === "motion" 
          ? <ShieldAlert className="h-4 w-4 text-warning" /> 
          : <Volume2 className="h-4 w-4 text-info" />,
      });
    });

    return items.sort((a, b) => b.time - a.time);
  }, [cameras, streamStatus, events, t, tError]);

  const activeCount = notifications.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {activeCount > 0 && (
            <Badge 
              variant="destructive" 
              className="absolute -top-1 -right-1 h-4 w-4 p-0 flex items-center justify-center text-[9px] font-bold"
            >
              {activeCount > 9 ? "9+" : activeCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="font-semibold text-sm">{t("notifications")}</div>
          {activeCount > 0 && (
            <Badge variant="destructive" className="text-[10px] px-1.5">{activeCount} {lang === "id" ? "Pemberitahuan" : "Notifications"}</Badge>
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
                    if (notif.type === "warning") {
                      navigate("/events");
                    } else {
                      navigate(`/cameras?site=${encodeURIComponent(notif.site)}&highlight=${notif.cameraId}`);
                    }
                  }}
                  className="flex items-start gap-3 p-3 text-left hover:bg-accent/50 transition-colors border-b last:border-0"
                >
                  <div className="mt-0.5 shrink-0">
                    {notif.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium leading-none mb-1">{notif.title}</div>
                    <div className="text-xs text-muted-foreground line-clamp-2">{notif.message}</div>
                    <div className="text-[10px] text-muted-foreground mt-2">
                      <span className="font-mono">{notif.site}</span>
                      <span className="mx-1">·</span>
                      <span className="font-mono">{new Date(notif.time).toLocaleTimeString("id-ID", { hour12: false })}</span>
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
