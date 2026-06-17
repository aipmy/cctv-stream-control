import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Cctv, Users as UsersIcon, Gauge, Timer, Signal } from "lucide-react";
import type { Camera } from "@/types";
import { cn } from "@/lib/utils";
import { CameraLiveView } from "@/components/CameraLiveView";

interface Props {
  camera: Camera | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

export function CameraPlayerModal({ camera, open, onOpenChange }: Props) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    if (!open) return;
    const i = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(i);
  }, [open]);

  if (!camera) return null;

  const stream = camera.streamType;
  const latency = stream === "HLS Low Latency" ? 650 : stream === "MJPEG" ? 700 : 1800;
  const bandwidth = stream === "HLS Low Latency" ? 1500 : stream === "MJPEG" ? 850 : 1200;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 py-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Cctv className="h-4 w-4 text-primary" />
            {camera.name}
            <span className="text-xs font-normal text-muted-foreground ml-2">{camera.site} · {camera.ip}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="relative aspect-video bg-black overflow-hidden">
          <CameraLiveView camera={camera} controls showErrorUrl />

          {camera.status !== "offline" && (
            <>
              <div className="absolute top-3 left-3 flex items-center gap-2 z-10 pointer-events-none">
                <Badge className="bg-destructive gap-1 text-[10px] uppercase tracking-wider">
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  Live
                </Badge>
                <Badge variant="outline" className="bg-black/50 text-white border-white/20 text-[10px]">{stream}</Badge>
              </div>
              <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-xs text-white/85 font-mono z-10 pointer-events-none">
                <span>{camera.brand} · {camera.qualityProfile}</span>
                <span>{now.toLocaleString("id-ID", { hour12: false })}</span>
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-4 border-t bg-card grid grid-cols-2 md:grid-cols-5 gap-4">
          <Metric icon={<UsersIcon className="h-3.5 w-3.5" />} label="Viewers" value={Math.max(camera.viewerCount, 0) + 1} />
          <Metric icon={<Gauge className="h-3.5 w-3.5" />} label="Bandwidth" value={`${(bandwidth / 1000).toFixed(2)} Mbps`} />
          <Metric icon={<Timer className="h-3.5 w-3.5" />} label="Latency" value={`${latency} ms`} tone={latency < 800 ? "success" : latency < 1300 ? "warning" : "default"} />
          <Metric icon={<Signal className="h-3.5 w-3.5" />} label="Kualitas" value={camera.qualityProfile} />
          <Metric icon={<Cctv className="h-3.5 w-3.5" />} label="Output" value={stream} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Metric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: React.ReactNode; tone?: "success" | "warning" | "default" }) {
  return (
    <div>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon}{label}
      </div>
      <div className={cn("text-sm font-semibold mt-1", tone === "success" && "text-success", tone === "warning" && "text-warning")}>{value}</div>
    </div>
  );
}
