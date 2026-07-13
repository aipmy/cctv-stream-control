import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Info, Server, Cpu, Layers, Tag } from "lucide-react";
import { useCameraHardwareInfoQuery } from "@/features/cameras/queries";
import { useTranslation } from "@/hooks/useTranslation";
import { cn } from "@/lib/utils";

interface CameraInfoDialogProps {
  cameraId: string;
  cameraName: string;
}

export function CameraInfoDialog({ cameraId, cameraName }: CameraInfoDialogProps) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError, error } = useCameraHardwareInfoQuery(cameraId, open);
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground shrink-0"
          title="Hardware Info"
        >
          <Info className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md border-border/60 bg-card/90 backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Server className="h-4 w-4 text-primary" />
            Device Information
          </DialogTitle>
        </DialogHeader>
        <div className="pt-2 pb-4">
          <div className="mb-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Camera</p>
            <p className="font-medium text-foreground">{cameraName}</p>
          </div>

          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground space-y-4">
              <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-sm">Fetching ONVIF data...</p>
            </div>
          ) : isError ? (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-4 text-center">
              <p className="text-sm text-destructive font-medium mb-1">Failed to fetch data</p>
              <p className="text-xs text-destructive/80">{(error as any)?.response?.data?.error || (error as Error).message}</p>
            </div>
          ) : data ? (
            <div className="grid gap-3">
              <InfoItem icon={<Tag className="h-4 w-4 text-blue-400" />} label="Manufacturer" value={data.Manufacturer} />
              <InfoItem icon={<Server className="h-4 w-4 text-purple-400" />} label="Model" value={data.Model} />
              <InfoItem icon={<Cpu className="h-4 w-4 text-emerald-400" />} label="Firmware Version" value={data.FirmwareVersion} />
              <InfoItem icon={<Layers className="h-4 w-4 text-orange-400" />} label="Serial Number" value={data.SerialNumber} />
              <InfoItem icon={<Info className="h-4 w-4 text-muted-foreground" />} label="Hardware ID" value={data.HardwareId} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">No data available.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InfoItem({ icon, label, value }: { icon: React.ReactNode; label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-black/20 border border-white/5">
      <div className="flex items-center gap-3">
        {icon}
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <span className="text-sm font-medium text-foreground text-right max-w-[180px] truncate" title={value}>
        {value}
      </span>
    </div>
  );
}
