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
import { ChangePasswordDialog } from "@/features/auth/ChangePasswordDialog";

const items = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard, roles: ["admin", "teknisi", "guest"] },
  { title: "Kamera", url: "/cameras", icon: Cctv, roles: ["admin", "teknisi", "guest"] },
  { title: "Pengguna", url: "/users", icon: Users, roles: ["admin"] },
  { title: "Pengaturan", url: "/settings", icon: SettingsIcon, roles: ["admin", "teknisi", "guest"] },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const logoutWithAudit = useAuth((s) => s.logoutWithAudit);
  const [passwordOpen, setPasswordOpen] = useState(false);

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
            <ShieldCheck className="h-5 w-5 text-primary-foreground" />
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
          <SidebarGroupLabel>Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items
                .filter((i) => !user || i.roles.includes(user.role))
                .map((item) => {
                  const active = pathname === item.url;
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild isActive={active}>
                        <NavLink to={item.url} className={cn("flex items-center gap-2")}>
                          <item.icon className="h-4 w-4" />
                          {!collapsed && <span>{item.title}</span>}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded-md p-2 text-left hover:bg-sidebar-accent",
                  collapsed && "justify-center",
                )}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <UserRound className="h-4 w-4" />
                </span>
                {!collapsed && (
                  <>
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate text-xs font-medium">{user.username}</span>
                      <span className="block text-[10px] capitalize text-muted-foreground">{user.role}</span>
                    </span>
                    <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                  </>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-56">
              <DropdownMenuLabel>
                <div className="text-xs font-medium">{user.username}</div>
                <div className="text-[10px] font-normal capitalize text-muted-foreground">{user.role}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setPasswordOpen(true)}>
                <KeyRound className="mr-2 h-4 w-4" />
                Ubah password
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void logout()} className="text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                Keluar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </SidebarFooter>
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </Sidebar>
  );
}
