import { useState, useMemo } from "react";
import { Bell, AlertTriangle, AlertCircle, X, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCamerasQuery } from "@/features/cameras/queries";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/features/auth/store";
import { streamApi } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";

export function NotificationBell() {
  const { data: cameras = [] } = useCamerasQuery();
  const { data: streamStatus = [] } = useQuery({
    queryKey: ["streamStatus"],
    queryFn: streamApi.status,
    refetchInterval: 10000,
  });
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const user = useAuth((s) => s.user);

  const notifications = useMemo(() => {
    const items: Array<{ id: string; type: "error" | "warning"; title: string; message: string; cameraId: string; time: number }> = [];
    
    // Add Stream Errors
    for (const status of streamStatus) {
      if (status.status === "error" || status.error) {
        const cam = cameras.find((c) => c.id === status.id);
        if (cam) {
          items.push({
            id: `stream_${status.id}_${status.output}`,
            type: "error",
            title: `Stream Error: ${cam.name}`,
            message: status.error?.message || "Gagal memulai stream",
            cameraId: cam.id,
            time: Date.now() // Approximated
          });
        }
      }
    }

    // Add Camera Errors
    for (const cam of cameras) {
      if (cam.errorHistory && cam.errorHistory.length > 0) {
        // Take latest error
        const err = cam.errorHistory[cam.errorHistory.length - 1];
        items.push({
          id: `cam_err_${cam.id}_${err.timestamp}`,
          type: cam.status === "offline" ? "error" : "warning",
          title: `Camera Issue: ${cam.name}`,
          message: err.message,
          cameraId: cam.id,
          time: new Date(err.timestamp).getTime()
        });
      }
    }

    return items.sort((a, b) => b.time - a.time).slice(0, 20); // Top 20
  }, [cameras, streamStatus]);

  const errorCount = notifications.filter((n) => n.type === "error").length;
  const warningCount = notifications.filter((n) => n.type === "warning").length;
  const totalCount = errorCount + warningCount;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {totalCount > 0 && (
            <Badge 
              variant="destructive" 
              className="absolute -top-1 -right-1 h-4 w-4 p-0 flex items-center justify-center text-[9px] font-bold"
            >
              {totalCount > 9 ? "9+" : totalCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="font-semibold text-sm">Notifikasi</div>
          <div className="flex gap-1.5">
            {errorCount > 0 && <Badge variant="destructive" className="h-5 text-[10px] px-1.5">{errorCount} Errors</Badge>}
            {warningCount > 0 && <Badge variant="outline" className="h-5 text-[10px] px-1.5 text-warning border-warning/50">{warningCount} Warnings</Badge>}
          </div>
        </div>
        
        <ScrollArea className="h-[300px]">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-6 text-center space-y-2">
              <Bell className="h-8 w-8 opacity-20" />
              <div className="text-sm">Tidak ada notifikasi</div>
              <div className="text-xs opacity-70">Sistem berjalan normal</div>
            </div>
          ) : (
            <div className="flex flex-col">
              {notifications.map((notif) => (
                <button
                  key={notif.id}
                  onClick={() => {
                    setOpen(false);
                    // Navigate to cameras management with a specific highlight maybe
                    navigate("/cameras");
                  }}
                  className="flex items-start gap-3 p-3 text-left hover:bg-accent/50 transition-colors border-b last:border-0"
                >
                  <div className="mt-0.5 shrink-0">
                    {notif.type === "error" ? (
                      <AlertCircle className="h-4 w-4 text-destructive" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-warning" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium leading-none mb-1">{notif.title}</div>
                    <div className="text-xs text-muted-foreground line-clamp-2">{notif.message}</div>
                    <div className="text-[10px] text-muted-foreground mt-2 font-mono">
                      {new Date(notif.time).toLocaleTimeString("id-ID")}
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
