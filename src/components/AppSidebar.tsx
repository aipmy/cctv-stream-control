import { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, Cctv, Users, Settings as SettingsIcon, ShieldCheck, UserRound, KeyRound, LogOut, ChevronsUpDown } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
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
import { useTranslation } from "@/hooks/useTranslation";
import { ChangePasswordDialog } from "@/features/auth/ChangePasswordDialog";
import type { TranslationKey } from "@/hooks/useTranslation";

interface SidebarItem {
  titleKey: TranslationKey;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: string[];
}

const items: SidebarItem[] = [
  { titleKey: "dashboard", url: "/", icon: LayoutDashboard, roles: ["admin", "teknisi", "guest", "internal", "external"] },
  { titleKey: "cameras", url: "/cameras", icon: Cctv, roles: ["admin", "teknisi", "guest", "internal", "external"] },
  { titleKey: "users", url: "/users", icon: Users, roles: ["admin"] },
  { titleKey: "settings", url: "/settings", icon: SettingsIcon, roles: ["admin", "teknisi", "guest", "internal", "external"] },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const logoutWithAudit = useAuth((s) => s.logoutWithAudit);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const { t } = useTranslation();

  const logout = async () => {
    try {
      await logoutWithAudit();
    } finally {
      navigate("/login");
    }
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-gradient-primary shadow-glow">
            <Cctv className="h-5 w-5 text-primary-foreground" />
          </div>
          {!collapsed && (
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-tight">CCTV Lite</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Monitoring v1.0</div>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t("menu")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items
                .filter((item) => {
                  if (!user) return false;
                  if (item.url === "/users") return user.role === "admin";
                  if (item.url === "/cameras") return user.role === "admin" || !!user.permissions?.canViewManagement;
                  return item.roles.includes(user.role);
                })
                .map((item) => {
                  const active = pathname === item.url;
                  const title = t(item.titleKey);
                  return (
                    <SidebarMenuItem key={item.titleKey}>
                      <SidebarMenuButton asChild isActive={active}>
                        <NavLink to={item.url} className={cn("flex items-center gap-2")}>
                          <item.icon className="h-4 w-4" />
                          {!collapsed && <span>{title}</span>}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

    </Sidebar>
  );
}
