import { NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, Cctv, Users, Settings as SettingsIcon, Bell, PlayCircle } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/features/auth/store";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";
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
  { titleKey: "playback", url: "/playback", icon: PlayCircle, roles: ["admin", "teknisi", "guest", "internal", "external"] },
  { titleKey: "events", url: "/events", icon: Bell, roles: ["admin", "teknisi", "guest", "internal", "external"] },
  { titleKey: "users", url: "/users", icon: Users, roles: ["admin"] },
  { titleKey: "settings", url: "/settings", icon: SettingsIcon, roles: ["admin", "teknisi", "guest", "internal", "external"] },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { pathname } = useLocation();
  const user = useAuth((s) => s.user);
  const { t } = useTranslation();

  return (
    <Sidebar collapsible="icon" className="border-r border-white/5 bg-slate-950/60 backdrop-blur-xl transition-all duration-300">
      <SidebarHeader className="border-b border-white/5 py-4 bg-slate-955/10">
        <div className="flex items-center gap-2.5 px-3 relative">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-primary shadow-glow relative shrink-0">
            <Cctv className="h-5 w-5 text-primary-foreground" />
            <span className="absolute -top-1 -right-1 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
          </div>
          {!collapsed && (
            <div className="leading-tight">
              <div className="text-xs font-bold tracking-widest text-slate-100 uppercase">CCTV Lite</div>
              <div className="text-[9px] uppercase tracking-widest text-slate-500 font-medium">Monitoring</div>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 pt-4 bg-slate-955/10">
        <SidebarGroup>
          {!collapsed && (
            <SidebarGroupLabel className="text-[10px] uppercase font-bold tracking-widest text-slate-500 px-3 mb-2">
              {t("menu")}
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu className="gap-1.5">
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
                    <SidebarMenuItem key={item.titleKey} className="relative">
                      {active && (
                        <div className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-full bg-primary shadow-[0_0_8px_#14b8a6]" />
                      )}
                      <SidebarMenuButton 
                        asChild 
                        isActive={active}
                        className={cn(
                          "w-full h-10 px-3 rounded-xl transition-all duration-200 group relative",
                          active 
                            ? "bg-primary/10 border border-primary/20 text-primary shadow-[0_0_12px_rgba(20,184,166,0.12)] font-semibold" 
                            : "text-slate-400 border border-transparent hover:text-slate-100 hover:bg-white/5 hover:translate-x-0.5"
                        )}
                      >
                        <NavLink to={item.url} className="flex items-center gap-3">
                          <item.icon className={cn("h-4 w-4 transition-colors", active ? "text-primary" : "text-slate-400 group-hover:text-slate-100")} />
                          {!collapsed && <span className="text-[13px]">{title}</span>}
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
