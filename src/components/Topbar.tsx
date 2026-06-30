import { useState } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Activity, UserRound, ChevronsUpDown, KeyRound, LogOut, Globe } from "lucide-react";
import { useCamerasQuery } from "@/features/cameras/queries";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/features/auth/store";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChangePasswordDialog } from "@/features/auth/ChangePasswordDialog";
import { GlobalThemeToggle } from "./GlobalThemeToggle";
import { NotificationBell } from "./NotificationBell";
import { useTranslation } from "@/hooks/useTranslation";
import { useLangStore } from "@/features/ui/useLangStore";
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
import { useNavigate } from "react-router-dom";
import { Button } from "./ui/button";

export function Topbar() {
  const camerasQuery = useCamerasQuery();
  const cameras = camerasQuery.data || [];
  const online = cameras.filter((c) => c.status === "online").length;

  const user = useAuth((s) => s.user);
  const logoutWithAudit = useAuth((s) => s.logoutWithAudit);
  const navigate = useNavigate();

  const [passwordOpen, setPasswordOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);

  const { t, lang } = useTranslation();
  const setLang = useLangStore((s) => s.setLang);

  const handleLogout = async () => {
    try {
      await logoutWithAudit();
    } finally {
      navigate("/login");
    }
  };

  return (
    <header className="h-14 flex items-center justify-between border-b border-border/40 dark:border-white/5 bg-background/60 dark:bg-slate-950/40 backdrop-blur-md px-4 sticky top-0 z-30">
      <div className="flex items-center gap-2">
        <SidebarTrigger />
        <div className="hidden md:flex items-center gap-2 ml-2">
          <Activity className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">{t("monitoringCenter")}</span>
          <Badge variant="outline" className="ml-1 bg-emerald-500/10 border-emerald-500/20 text-emerald-400 flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse mr-1.5 shadow-[0_0_8px_#10b981]" />
            {online}/{cameras.length} online
          </Badge>
          <Badge variant="outline" className={cn(
            "flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold",
            camerasQuery.isError 
              ? "bg-rose-500/10 border-rose-500/20 text-rose-400" 
              : "bg-cyan-500/10 border-cyan-500/20 text-cyan-400"
          )} title={camerasQuery.error instanceof Error ? camerasQuery.error.message : undefined}>
            <span className={cn(
              "h-1.5 w-1.5 rounded-full mr-1.5",
              camerasQuery.isError 
                ? "bg-rose-400 animate-pulse shadow-[0_0_8px_#f43f5e]" 
                : "bg-cyan-400 animate-pulse shadow-[0_0_8px_#06b6d4]"
            )} />
            Backend {camerasQuery.isError ? "Error" : "OK"}
          </Badge>
        </div>
      </div>
      
      <div className="flex items-center gap-2 pr-2">
        <GlobalThemeToggle className="relative shrink-0" />
        
        <div className="inline-flex rounded-lg border border-border/40 dark:border-white/5 bg-muted/40 dark:bg-slate-900/40 p-0.5 select-none shrink-0">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setLang("en")}
            className={cn(
              "h-7 px-2.5 text-[10px] font-bold uppercase rounded-md transition-all duration-200",
              lang === "en" 
                ? "bg-primary text-white shadow-lg shadow-primary/20" 
                : "text-muted-foreground dark:text-slate-400 hover:text-foreground dark:hover:text-slate-200"
            )}
          >
            EN
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setLang("id")}
            className={cn(
              "h-7 px-2.5 text-[10px] font-bold uppercase rounded-md transition-all duration-200",
              lang === "id" 
                ? "bg-primary text-white shadow-lg shadow-primary/20" 
                : "text-muted-foreground dark:text-slate-400 hover:text-foreground dark:hover:text-slate-200"
            )}
          >
            ID
          </Button>
        </div>

        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-2 rounded-xl p-1 pl-2 text-left bg-muted/40 dark:bg-slate-900/40 border border-border/40 dark:border-white/5 hover:bg-muted/80 dark:hover:bg-slate-900/80 transition-all duration-200"
              >
                <div className="flex flex-col items-end hidden sm:flex leading-tight pr-1">
                  <span className="block truncate text-[11px] font-bold text-foreground dark:text-slate-200">{user.username}</span>
                  <span className="block text-[9px] uppercase tracking-wider font-semibold text-muted-foreground dark:text-slate-500 mt-0.5">{user.role}</span>
                </div>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 border border-primary/20 text-primary">
                  <UserRound className="h-4 w-4" />
                </span>
                <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end" className="w-56 bg-popover dark:bg-slate-900 border border-border/40 dark:border-white/10 text-popover-foreground dark:text-slate-200">
              <DropdownMenuLabel>
                <div className="text-xs font-semibold text-foreground dark:text-slate-200">{user.username}</div>
                <div className="text-[10px] font-normal capitalize text-muted-foreground dark:text-slate-500">{user.role}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-border/40 dark:bg-white/5" />
              <DropdownMenuItem onSelect={() => setPasswordOpen(true)} className="hover:bg-muted dark:hover:bg-white/5 focus:bg-muted dark:focus:bg-white/5 cursor-pointer">
                <KeyRound className="mr-2 h-4 w-4 text-muted-foreground dark:text-slate-400" />
                {t("changePassword")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setLogoutOpen(true)} className="text-destructive focus:text-destructive hover:bg-rose-500/10 focus:bg-rose-500/10 cursor-pointer">
                <LogOut className="mr-2 h-4 w-4" />
                {t("logout")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <NotificationBell />
      </div>

      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />

      <AlertDialog open={logoutOpen} onOpenChange={setLogoutOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmLogout")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("logoutMessage")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleLogout()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t("logout")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </header>
  );
}
