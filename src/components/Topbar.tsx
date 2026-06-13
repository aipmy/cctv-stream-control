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
    <header className="h-14 flex items-center justify-between border-b bg-card/60 backdrop-blur px-3 sticky top-0 z-30">
      <div className="flex items-center gap-2">
        <SidebarTrigger />
        <div className="hidden md:flex items-center gap-2 ml-2">
          <Activity className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">{t("monitoringCenter")}</span>
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
      
      <div className="flex items-center gap-2 pr-2">
        <div className="inline-flex rounded-md border bg-muted/30 p-0.5 select-none shrink-0">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setLang("en")}
            className={cn(
              "h-7 px-2 text-[10px] font-semibold uppercase rounded-sm",
              lang === "en" && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
            )}
          >
            EN
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setLang("id")}
            className={cn(
              "h-7 px-2 text-[10px] font-semibold uppercase rounded-sm",
              lang === "id" && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
            )}
          >
            ID
          </Button>
        </div>
        <NotificationBell />
        <GlobalThemeToggle />
        
        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-2 rounded-md p-1 pl-2 text-left hover:bg-muted"
              >
                <div className="flex flex-col items-end hidden sm:flex">
                  <span className="block truncate text-xs font-medium leading-none">{user.username}</span>
                  <span className="block text-[10px] capitalize text-muted-foreground mt-1 leading-none">{user.role}</span>
                </div>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <UserRound className="h-4 w-4" />
                </span>
                <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="text-xs font-medium">{user.username}</div>
                <div className="text-[10px] font-normal capitalize text-muted-foreground">{user.role}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setPasswordOpen(true)}>
                <KeyRound className="mr-2 h-4 w-4" />
                {t("changePassword")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setLogoutOpen(true)} className="text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                {t("logout")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
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
