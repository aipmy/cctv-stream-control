import { useState } from "react";
import { Outlet, Navigate, useLocation, Link, NavLink, useNavigate } from "react-router-dom";
import { 
  Loader2, 
  LayoutDashboard, 
  MonitorPlay, 
  PlayCircle, 
  Bell, 
  Menu, 
  Cctv, 
  Users, 
  Settings as SettingsIcon, 
  LogOut, 
  KeyRound, 
  UserRound 
} from "lucide-react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { Topbar } from "./Topbar";
import { useAuth } from "@/features/auth/store";
import { useSettings } from "@/features/settings/store";
import { useCameraStats, useCamerasQuery } from "@/features/cameras/queries";
import { useUsersQuery } from "@/features/users/queries";
import { useTranslation } from "@/hooks/useTranslation";
import { cn } from "@/lib/utils";
import { 
  Sheet, 
  SheetContent, 
  SheetHeader, 
  SheetTitle, 
  SheetTrigger 
} from "@/components/ui/sheet";
import { ChangePasswordDialog } from "@/features/auth/ChangePasswordDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function AppLayout() {
  const user = useAuth((s) => s.user);
  const logoutWithAudit = useAuth((s) => s.logoutWithAudit);
  const autoRefresh = useSettings((s) => s.settings.autoRefresh);
  const camerasQuery = useCamerasQuery(Boolean(user));
  const cameras = camerasQuery.data || [];
  const location = useLocation();
  const navigate = useNavigate();
  
  const { t, lang } = useTranslation();

  const [menuOpen, setMenuOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);

  // Hanya fetch/poll stats jika user berada di Dashboard, Manajemen Kamera, atau Live View
  const isStatsNeeded = location.pathname === "/" || location.pathname === "/cameras" || location.pathname === "/live";
  useCameraStats(Boolean(user) && camerasQuery.isSuccess && isStatsNeeded, autoRefresh);
  useUsersQuery(user?.role === "admin");

  if (!user) return <Navigate to="/login" replace />;
  
  // Only show full-screen loading on first mount when there's no cached data.
  // On subsequent navigations/refetches the cached data persists, avoiding blank pages.
  if (camerasQuery.isPending && !camerasQuery.data) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        Memuat kamera...
      </div>
    );
  }

  const handleLogout = async () => {
    try {
      await logoutWithAudit();
    } finally {
      navigate("/login");
    }
  };

  const navItemClass = ({ isActive }: { isActive: boolean }) => cn(
    "flex flex-col items-center justify-center gap-1 flex-1 h-full transition-colors relative py-1",
    isActive ? "text-primary font-bold" : "text-muted-foreground hover:text-foreground"
  );

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background pb-16 md:pb-0">
        {/* Hide desktop sidebar on mobile/tablet */}
        <div className="hidden md:block">
          <AppSidebar />
        </div>
        
        <div className="flex-1 flex flex-col min-w-0">
          <Topbar />
          <main className="flex-1 p-4 md:p-6 animate-page-fade-in">
            <Outlet />
          </main>
        </div>

        {/* Floating Mobile Bottom Navigation Bar */}
        <div className="fixed bottom-0 left-0 right-0 h-16 z-40 bg-background/80 dark:bg-slate-955/80 backdrop-blur-lg border-t border-border/40 dark:border-white/5 flex items-center justify-around px-2 pb-safe md:hidden shadow-lg">
          <NavLink to="/" className={navItemClass}>
            <LayoutDashboard className="h-5.5 w-5.5" />
            <span className="text-[9.5px] tracking-wide font-medium">{t("dashboard")}</span>
          </NavLink>
          
          <NavLink to="/live" className={navItemClass}>
            <MonitorPlay className="h-5.5 w-5.5" />
            <span className="text-[9.5px] tracking-wide font-medium">{t("liveView")}</span>
          </NavLink>

          <NavLink to="/playback" className={navItemClass}>
            <PlayCircle className="h-5.5 w-5.5" />
            <span className="text-[9.5px] tracking-wide font-medium">{t("playback")}</span>
          </NavLink>

          <NavLink to="/events" className={navItemClass}>
            <Bell className="h-5.5 w-5.5" />
            <span className="text-[9.5px] tracking-wide font-medium">{t("events")}</span>
          </NavLink>

          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <button 
                type="button"
                className={cn(
                  "flex flex-col items-center justify-center gap-1 flex-1 h-full transition-colors relative py-1",
                  menuOpen ? "text-primary font-bold" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Menu className="h-5.5 w-5.5" />
                <span className="text-[9.5px] tracking-wide font-medium">{lang === "id" ? "Menu" : "More"}</span>
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="rounded-t-2xl p-4 bg-popover dark:bg-slate-900 border-t border-border/40 dark:border-white/10 max-h-[85vh] overflow-y-auto">
              <SheetHeader className="pb-3 border-b border-border/30 dark:border-white/5">
                <SheetTitle className="text-sm font-bold flex items-center gap-2.5">
                  <span className="flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-xl bg-primary/10 border border-primary/20 text-primary">
                    <UserRound className="h-4.5 w-4.5" />
                  </span>
                  <div className="text-left leading-tight">
                    <div className="text-xs font-bold text-foreground">{user.username}</div>
                    <div className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground mt-0.5">{user.role}</div>
                  </div>
                </SheetTitle>
              </SheetHeader>
              
              <div className="py-4 grid grid-cols-2 gap-3">
                {/* Cameras Management */}
                {(user.role === "admin" || !!user.permissions?.canViewManagement) && (
                  <Link 
                    to="/cameras" 
                    onClick={() => setMenuOpen(false)}
                    className="flex flex-col items-center justify-center gap-2 p-3.5 rounded-xl border border-border/40 dark:border-white/5 bg-muted/20 hover:bg-muted/40 transition-colors text-center"
                  >
                    <Cctv className="h-5.5 w-5.5 text-primary" />
                    <span className="text-[11px] font-semibold text-foreground">{t("cameras")}</span>
                  </Link>
                )}
                
                {/* Users Management */}
                {user.role === "admin" && (
                  <Link 
                    to="/users" 
                    onClick={() => setMenuOpen(false)}
                    className="flex flex-col items-center justify-center gap-2 p-3.5 rounded-xl border border-border/40 dark:border-white/5 bg-muted/20 hover:bg-muted/40 transition-colors text-center"
                  >
                    <Users className="h-5.5 w-5.5 text-indigo-500" />
                    <span className="text-[11px] font-semibold text-foreground">{t("users")}</span>
                  </Link>
                )}

                {/* Settings */}
                <Link 
                  to="/settings" 
                  onClick={() => setMenuOpen(false)}
                  className="flex flex-col items-center justify-center gap-2 p-3.5 rounded-xl border border-border/40 dark:border-white/5 bg-muted/20 hover:bg-muted/40 transition-colors text-center"
                >
                  <SettingsIcon className="h-5.5 w-5.5 text-amber-500" />
                  <span className="text-[11px] font-semibold text-foreground">{t("settings")}</span>
                </Link>

                {/* Change Password */}
                <button 
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setPasswordOpen(true);
                  }}
                  className="flex flex-col items-center justify-center gap-2 p-3.5 rounded-xl border border-border/40 dark:border-white/5 bg-muted/20 hover:bg-muted/40 transition-colors text-center"
                >
                  <KeyRound className="h-5.5 w-5.5 text-teal-500" />
                  <span className="text-[11px] font-semibold text-foreground">{lang === "id" ? "Ganti Sandi" : "Password"}</span>
                </button>

                {/* Logout Button (Span 2 columns) */}
                <button 
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setLogoutOpen(true);
                  }}
                  className="col-span-2 flex items-center justify-center gap-2 p-3.5 mt-2 rounded-xl bg-destructive/10 hover:bg-destructive/20 border border-destructive/20 text-destructive transition-colors text-xs font-bold"
                >
                  <LogOut className="h-4 w-4" />
                  {lang === "id" ? "Keluar Akun" : "Logout"}
                </button>
              </div>
            </SheetContent>
          </Sheet>
        </div>

        {/* Dialogs */}
        <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />

        <AlertDialog open={logoutOpen} onOpenChange={setLogoutOpen}>
          <AlertDialogContent className="bg-popover dark:bg-slate-900 border border-border/40 dark:border-white/10">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-foreground">{lang === "id" ? "Konfirmasi Keluar" : "Confirm Logout"}</AlertDialogTitle>
              <AlertDialogDescription className="text-muted-foreground">
                {lang === "id" 
                  ? "Apakah Anda yakin ingin keluar dari sistem CCTV?" 
                  : "Are you sure you want to logout from the CCTV system?"}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="bg-muted hover:bg-muted/80 text-foreground border-0">{t("cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void handleLogout()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                {lang === "id" ? "Ya, Keluar" : "Logout"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </SidebarProvider>
  );
}
