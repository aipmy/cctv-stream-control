import { Outlet, Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { Topbar } from "./Topbar";
import { useAuth } from "@/features/auth/store";
import { useSettings } from "@/features/settings/store";
import { useCameraStats, useCamerasQuery } from "@/features/cameras/queries";
import { useUsersQuery } from "@/features/users/queries";

export function AppLayout() {
  const user = useAuth((s) => s.user);
  const autoRefresh = useSettings((s) => s.settings.autoRefresh);
  const cameras = useCamerasQuery(Boolean(user));
  useCameraStats(Boolean(user) && cameras.isSuccess, autoRefresh);
  useUsersQuery(user?.role === "admin");

  if (!user) return <Navigate to="/login" replace />;
  if (cameras.isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        Memuat kamera...
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <Topbar />
          <main className="flex-1 p-4 md:p-6 animate-fade-in">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
