import { Camera as CameraIcon, Wifi, WifiOff, Radio, Gauge, HardDrive } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  icon: "camera" | "online" | "offline" | "stream" | "bandwidth" | "disk";
  tone?: "default" | "success" | "destructive" | "info" | "warning";
}

const icons = {
  camera: CameraIcon, online: Wifi, offline: WifiOff, stream: Radio, bandwidth: Gauge, disk: HardDrive,
};

const toneMap: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "text-primary bg-primary/10",
  success: "text-success bg-success/10",
  destructive: "text-destructive bg-destructive/10",
  info: "text-info bg-info/10",
  warning: "text-warning bg-warning/10",
};

export function StatCard({ label, value, hint, icon, tone = "default" }: StatCardProps) {
  const Icon = icons[icon];
  return (
    <Card className="p-4 glass-panel border-border/60">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="text-2xl font-semibold tracking-tight mt-1">{value}</div>
          {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
        </div>
        <div className={cn("h-9 w-9 rounded-md flex items-center justify-center", toneMap[tone])}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </Card>
  );
}
