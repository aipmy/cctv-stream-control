import { Camera as CameraIcon, Wifi, WifiOff, Radio, Gauge, HardDrive, Cpu, Activity } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon: "camera" | "online" | "offline" | "stream" | "bandwidth" | "disk" | "cpu" | "ram";
  tone?: "default" | "success" | "destructive" | "info" | "warning";
  children?: React.ReactNode;
}

const icons = {
  camera: CameraIcon, online: Wifi, offline: WifiOff, stream: Radio, bandwidth: Gauge, disk: HardDrive, cpu: Cpu, ram: Activity,
};

const toneMap: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "text-primary bg-primary/10",
  success: "text-success bg-success/10",
  destructive: "text-destructive bg-destructive/10",
  info: "text-info bg-info/10",
  warning: "text-warning bg-warning/10",
};

export function StatCard({ label, value, hint, icon, tone = "default", children }: StatCardProps) {
  const Icon = icons[icon];
  return (
    <Card className="p-4 glass-panel border-border/60 h-full flex flex-col justify-between overflow-hidden">
      <div className="flex items-start justify-between gap-2.5 w-full">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground/80 block leading-tight">{label}</div>
          <div className="text-[15px] xs:text-[17px] sm:text-xl md:text-2xl font-bold tracking-tight mt-1 text-foreground block leading-tight break-all sm:break-normal">{value}</div>
          {hint && <div className="text-[10px] text-muted-foreground/70 mt-1 block leading-normal">{hint}</div>}
          {children}
        </div>
        <div className={cn("h-8.5 w-8.5 rounded-md flex items-center justify-center shrink-0", toneMap[tone])}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </Card>
  );
}
