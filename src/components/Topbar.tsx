import { SidebarTrigger } from "@/components/ui/sidebar";
import { Activity } from "lucide-react";
import { useCamerasQuery } from "@/features/cameras/queries";
import { Badge } from "@/components/ui/badge";

export function Topbar() {
  const camerasQuery = useCamerasQuery();
  const cameras = camerasQuery.data || [];
  const online = cameras.filter((c) => c.status === "online").length;

  return (
    <header className="h-14 flex items-center justify-between border-b bg-card/60 backdrop-blur px-3 pr-20 sticky top-0 z-30">
      <div className="flex items-center gap-2">
        <SidebarTrigger />
        <div className="hidden md:flex items-center gap-2 ml-2">
          <Activity className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Pusat Monitoring</span>
          <Badge variant="outline" className="ml-1 border-success/40 text-success">
            <span className="status-dot status-dot-online mr-1.5" />
            {online}/{cameras.length} online
          </Badge>
          <Badge variant="outline" className={camerasQuery.isError ? "border-destructive/40 text-destructive" : "border-info/40 text-info"} title={camerasQuery.error instanceof Error ? camerasQuery.error.message : undefined}>
            <span className={camerasQuery.isError ? "status-dot status-dot-offline mr-1.5" : "status-dot status-dot-online mr-1.5"} />
            Backend {camerasQuery.isError ? "Error" : "OK"}
          </Badge>
        </div>
      </div>
      <div />
    </header>
  );
}
