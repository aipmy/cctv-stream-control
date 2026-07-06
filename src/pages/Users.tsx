import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/features/auth/store";
import { useAuditQuery, useUserActions, useUsersQuery } from "@/features/users/queries";
import { useCamerasQuery } from "@/features/cameras/queries";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Plus, Pencil, Trash2, ScrollText, Loader2, Download, ChevronsUpDown, User, Calendar, ShieldCheck } from "lucide-react";
import type { AuditOutcome, CreateUserInput, Role, UserSummary } from "@/types";
import { auditApi } from "@/lib/api";
import { toast } from "sonner";
import { PasswordStrengthMeter } from "@/components/PasswordStrengthMeter";
import { useTranslation } from "@/hooks/useTranslation";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const roleColors: Record<Role, string> = {
  admin: "bg-primary/10 text-primary border-primary/20 shadow-[0_0_8px_rgba(20,184,166,0.1)]",
  teknisi: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  guest: "bg-muted text-muted-foreground border-border/40",
  internal: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  external: "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

export default function Users() {
  const role = useAuth((s) => s.user?.role);
  const { data: usersData } = useUsersQuery(role === "admin");
  const users = useMemo(() => usersData || [], [usersData]);
  const { data: camerasData } = useCamerasQuery();
  const cameras = useMemo(() => camerasData || [], [camerasData]);
  const siteOptions = useMemo(() => Array.from(new Set(cameras.map((c) => c.site).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [cameras]);
  const { addUser, updateUser, deleteUser } = useUserActions();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<UserSummary | null>(null);
  const [del, setDel] = useState<UserSummary | null>(null);
  const emptyPermissions = { canAddCamera: false, canEditCamera: false, canDeleteCamera: false, canRestartStream: false, canViewManagement: false, canPlayAudio: false, canViewStats: false, canControlPTZ: false, canViewPlayback: false, canViewEvents: false };
  const [form, setForm] = useState<CreateUserInput>({ username: "", password: "", role: "guest", active: true, permissions: emptyPermissions, allowedGroups: [] });
  const [saving, setSaving] = useState(false);
  const [auditActor, setAuditActor] = useState("");
  const [auditAction, setAuditAction] = useState("");
  const [auditOutcome, setAuditOutcome] = useState<AuditOutcome | "all">("all");
  
  const { t, lang } = useTranslation();

  const auditFilters = useMemo(() => ({
    limit: 50,
    actor: auditActor.trim() || undefined,
    action: auditAction.trim() || undefined,
    outcome: auditOutcome,
  }), [auditAction, auditActor, auditOutcome]);
  const audit = useAuditQuery(auditFilters, role === "admin");
  const auditItems = audit.data?.pages.flatMap((page) => page.items) || [];

  const formatExactTime = (iso: string) => {
    const date = new Date(iso);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    const min = String(date.getMinutes()).padStart(2, "0");
    const ss = String(date.getSeconds()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
  };

  if (role !== "admin") return <Navigate to="/" replace />;

  const openNew = () => { 
    setEdit(null); 
    setForm({ username: "", password: "", role: "guest", active: true, permissions: emptyPermissions, allowedGroups: [] }); 
    setOpen(true); 
  };
  
  const openEdit = (u: UserSummary) => {
    setEdit(u);
    setForm({ username: u.username, password: "", role: u.role, active: u.active, permissions: u.permissions || emptyPermissions, allowedGroups: u.allowedGroups || [] });
    setOpen(true);
  };

  const submit = async () => {
    if (!form.username.trim()) {
      return toast.error(lang === "id" ? "Username wajib diisi" : "Username is required");
    }
    if (!edit && !form.password.trim()) {
      return toast.error(lang === "id" ? "Password wajib diisi untuk pengguna baru" : "Password is required for new users");
    }
    setSaving(true);
    try {
      const finalPermissions = form.role === "admin"
        ? {
            canAddCamera: true,
            canEditCamera: true,
            canDeleteCamera: true,
            canRestartStream: true,
            canViewManagement: true,
            canPlayAudio: true,
            canViewStats: true,
            canControlPTZ: true,
            canViewPlayback: true,
            canViewEvents: true,
          }
        : form.permissions;

      const payload = {
        ...form,
        permissions: finalPermissions,
      };

      if (edit) { 
        await updateUser(edit.id, payload); 
        toast.success(lang === "id" ? "Pengguna diperbarui" : "User updated successfully"); 
      } else { 
        await addUser(payload); 
        toast.success(lang === "id" ? "Pengguna ditambahkan" : "User added successfully"); 
      }
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : (lang === "id" ? "Gagal menyimpan pengguna" : "Failed to save user"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <ShieldCheck className="h-5.5 w-5.5 text-primary" />
            {t("userManagement")}
          </h1>
          <p className="text-sm text-muted-foreground">{lang === "id" ? "Kelola akun operator dan hak akses khusus." : "Manage operator accounts and custom permissions."}</p>
        </div>
        <Button onClick={openNew} className="bg-gradient-primary text-primary-foreground hover:opacity-95 shadow-lg shadow-primary/10">
          <Plus className="h-4 w-4 mr-1.5" /> {t("addUser")}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">
        <div className="space-y-4">
          {/* Desktop Table View */}
          <Card className="overflow-hidden hidden md:block border border-border/40 dark:border-white/5 rounded-xl bg-card/65 backdrop-blur-sm shadow-2xl">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[180px]">Username</TableHead>
                  <TableHead className="w-[120px]">Role</TableHead>
                  <TableHead className="w-[100px]">{t("status")}</TableHead>
                  <TableHead>{t("lastLogin")}</TableHead>
                  <TableHead className="text-right w-[110px]">{t("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="font-semibold text-foreground">{u.username}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider", roleColors[u.role])}>
                        {t(u.role)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={u.active}
                        onCheckedChange={async (v) => {
                          try {
                            await updateUser(u.id, { active: v });
                            toast.success(
                              v 
                                ? (lang === "id" ? "Pengguna diaktifkan" : "User activated") 
                                : (lang === "id" ? "Pengguna dinonaktifkan" : "User deactivated")
                            );
                          } catch (err) {
                            toast.error(lang === "id" ? "Gagal mengubah status pengguna" : "Failed to update user status");
                          }
                        }}
                      />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono whitespace-nowrap">
                      {u.lastLoginAt ? formatExactTime(u.lastLoginAt) : <span className="text-muted-foreground/30">{t("neverLoggedIn")}</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button size="icon" variant="ghost" className="h-8 w-8 hover:bg-muted" onClick={() => openEdit(u)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => setDel(u)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* Mobile Card Stack View */}
          <div className="block md:hidden space-y-4">
            {users.map((u) => (
              <Card key={u.id} className="p-4 space-y-4 bg-card/65 backdrop-blur-sm border border-border/40 dark:border-white/5 rounded-xl">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-bold text-sm uppercase">
                      {u.username.substring(0, 2)}
                    </span>
                    <div>
                      <h3 className="font-semibold text-sm text-foreground leading-tight">{u.username}</h3>
                      <Badge variant="outline" className={cn("px-1.5 py-0 text-[9px] uppercase tracking-wider mt-1 block w-max", roleColors[u.role])}>
                        {t(u.role)}
                      </Badge>
                    </div>
                  </div>
                  <Switch
                    checked={u.active}
                    onCheckedChange={async (v) => {
                      try {
                        await updateUser(u.id, { active: v });
                        toast.success(
                          v 
                            ? (lang === "id" ? "Pengguna diaktifkan" : "User activated") 
                            : (lang === "id" ? "Pengguna dinonaktifkan" : "User deactivated")
                        );
                      } catch (err) {
                        toast.error(lang === "id" ? "Gagal mengubah status pengguna" : "Failed to update user status");
                      }
                    }}
                  />
                </div>

                <div className="border-t pt-3 border-border/40 dark:border-white/5 text-xs space-y-2">
                  <div>
                    <div className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider">{t("lastLogin")}</div>
                    <div className="font-mono mt-1 text-foreground/90 flex items-center gap-1.5">
                      <Calendar className="h-3 w-3 text-muted-foreground" />
                      {u.lastLoginAt ? formatExactTime(u.lastLoginAt) : <span className="text-muted-foreground/30">{t("neverLoggedIn")}</span>}
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 pt-3 border-t border-border/40 dark:border-white/5">
                  <Button 
                    size="sm" 
                    variant="outline" 
                    className="flex-1 h-9 text-xs gap-1.5"
                    onClick={() => openEdit(u)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    <span>Edit</span>
                  </Button>
                  <Button 
                    size="icon" 
                    variant="outline" 
                    className="h-9 w-9 text-destructive hover:bg-destructive/10"
                    onClick={() => setDel(u)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>

        {/* Audit / Recent Activity Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs uppercase font-bold tracking-widest text-muted-foreground flex items-center">
              <ScrollText className="mr-2 h-4 w-4 text-primary" /> 
              {t("recentActivity")}
            </h2>
            <Button variant="outline" size="sm" className="h-7 text-xs border-border/40" onClick={() => window.open(auditApi.exportUrl(), "_blank")}>
              <Download className="h-3 w-3 mr-1.5" /> Export
            </Button>
          </div>
          
          <Card className="flex flex-col h-[520px] bg-card/65 backdrop-blur-sm border border-border/40 dark:border-white/5 rounded-xl shadow-2xl overflow-hidden">
            <div className="p-3 border-b border-border/40 dark:border-white/5 space-y-2 bg-muted/20">
              <Input
                value={auditActor}
                onChange={(event) => setAuditActor(event.target.value)}
                placeholder="Filter actor/username"
                className="h-8 text-xs bg-background/50 border-border/40"
              />
              <Select value={auditOutcome} onValueChange={(value) => setAuditOutcome(value as AuditOutcome | "all")}>
                <SelectTrigger className="h-8 text-xs bg-background/50 border-border/40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{lang === "id" ? "Semua hasil" : "All outcomes"}</SelectItem>
                  <SelectItem value="success">Success</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5 pr-2">
              {auditItems.map((item) => (
                <div key={item.id} className="flex gap-3 pb-3.5 border-b border-border/30 dark:border-white/5 last:border-0 last:pb-0 text-xs transition-colors hover:bg-muted/10">
                  <div className="flex flex-col items-center shrink-0">
                    <span className={cn(
                      "h-2 w-2 rounded-full mt-1.5",
                      item.outcome === "success" 
                        ? "bg-emerald-500 shadow-[0_0_8px_#10b981]" 
                        : item.outcome === "warning"
                          ? "bg-amber-500 shadow-[0_0_8px_#f59e0b]"
                          : "bg-rose-500 shadow-[0_0_8px_#ef4444]"
                    )} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-foreground">{item.actor.username}</span>
                      <span className="text-[9px] text-muted-foreground font-mono shrink-0">
                        {new Date(item.ts).toLocaleTimeString("id-ID", { hour12: false })}
                      </span>
                    </div>
                    <div className="text-muted-foreground font-mono text-[10px] mt-1 break-all bg-muted/40 p-1.5 rounded border border-border/20">
                      {item.action}
                    </div>
                  </div>
                </div>
              ))}
              
              {!audit.isPending && auditItems.length === 0 && (
                <div className="py-16 text-center text-xs text-muted-foreground">
                  {lang === "id" ? "Belum ada audit log." : "No audit logs found."}
                </div>
              )}
              
              {audit.isPending && (
                <div className="flex items-center justify-center p-8 text-xs text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin text-primary" />
                  {t("loading")}
                </div>
              )}
              
              {audit.isError && (
                <div className="p-4 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg">
                  {audit.error instanceof Error ? audit.error.message : "Failed to load logs"}
                </div>
              )}
              
              {audit.hasNextPage && (
                <div className="pt-2 text-center">
                  <Button variant="outline" size="sm" className="h-8 text-xs w-full border-border/40" onClick={() => void audit.fetchNextPage()} disabled={audit.isFetchingNextPage}>
                    {audit.isFetchingNextPage ? t("loading") : (lang === "id" ? "Muat lebih banyak" : "Load more")}
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] gap-0 overflow-hidden p-0 flex flex-col border border-border/40 shadow-2xl max-w-lg rounded-xl">
          <DialogHeader className="shrink-0 border-b border-border/40 px-6 py-5 pr-12 bg-muted/20">
            <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2">
              <User className="h-5 w-5 text-primary" />
              {edit ? t("editUser") : t("addUser")}
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
            <div>
              <Label className="text-xs uppercase font-semibold text-muted-foreground tracking-wider">{t("username")}</Label>
              <Input className="mt-1.5 bg-background/50 border-border/40" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs uppercase font-semibold text-muted-foreground tracking-wider">{t("password")}</Label>
              <Input className="mt-1.5 bg-background/50 border-border/40" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
              <PasswordStrengthMeter password={form.password} />
              {edit && <p className="mt-1.5 text-xs text-muted-foreground/80">{lang === "id" ? "Kosongkan jika password tidak diubah." : "Leave blank if you do not want to change password."}</p>}
            </div>
            <div>
              <Label className="text-xs uppercase font-semibold text-muted-foreground tracking-wider">{t("role")}</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as Role })}>
                <SelectTrigger className="mt-1.5 bg-background/50 border-border/40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="teknisi">{t("teknisi")}</SelectItem>
                  <SelectItem value="guest">{t("guest")}</SelectItem>
                  <SelectItem value="internal">{t("internal")}</SelectItem>
                  <SelectItem value="external">{t("external")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border/40 p-3 bg-muted/10">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{lang === "id" ? "Status Aktif" : "Active Status"}</Label>
              <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
            </div>
            
            {form.role !== "admin" && (
              <div className="space-y-4 pt-4 border-t border-border/40 mt-4">
                <div>
                  <Label className="text-xs uppercase font-semibold text-muted-foreground tracking-wider block mb-2">{t("allowedGroups")}</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-between mt-1.5 text-left font-normal h-10 bg-background/50 border-border/40">
                        <span className="truncate text-xs">
                          {(form.allowedGroups || []).length === 0
                            ? (lang === "id" ? "Pilih grup..." : "Select groups...")
                            : (form.allowedGroups || []).length === siteOptions.length
                            ? (lang === "id" ? "Semua grup" : "All groups")
                            : (form.allowedGroups || []).join(", ")}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[300px] p-3 border border-border/40" align="start">
                      <div className="space-y-2">
                        <div className="flex items-center space-x-2 pb-2 border-b">
                          <Checkbox
                            id="site-select-all"
                            checked={siteOptions.length > 0 && (form.allowedGroups || []).length === siteOptions.length}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setForm({ ...form, allowedGroups: [...siteOptions] });
                              } else {
                                setForm({ ...form, allowedGroups: [] });
                              }
                            }}
                          />
                          <label htmlFor="site-select-all" className="text-xs font-semibold leading-none cursor-pointer flex-1 py-1">
                            {t("selectAll")}
                          </label>
                        </div>
                        <div className="max-h-48 overflow-y-auto space-y-2 pt-1">
                          {siteOptions.length === 0 && (
                            <div className="text-xs text-muted-foreground p-2 text-center">
                              {lang === "id" ? "Belum ada site." : "No sites available."}
                            </div>
                          )}
                          {siteOptions.map((site) => (
                            <div key={site} className="flex items-center space-x-2">
                              <Checkbox
                                id={`site-${site}`}
                                checked={(form.allowedGroups || []).includes(site)}
                                onCheckedChange={(checked) => {
                                  const prev = form.allowedGroups || [];
                                  if (checked) {
                                    setForm({ ...form, allowedGroups: [...prev, site] });
                                  } else {
                                    setForm({ ...form, allowedGroups: prev.filter((s) => s !== site) });
                                  }
                                }}
                              />
                              <label htmlFor={`site-${site}`} className="text-xs font-medium leading-none cursor-pointer flex-1 py-1">
                                {site}
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="flex items-center justify-between border-b border-border/40 pb-2 mt-4 mb-3">
                  <Label className="text-xs uppercase tracking-wider font-semibold text-foreground">{t("specificPermissions")}</Label>
                  <div className="flex items-center space-x-2">
                    <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{t("allPermissions")}</span>
                    <Switch
                      checked={
                        Object.keys(emptyPermissions).length > 0 &&
                        Object.keys(emptyPermissions).every((k) => !!form.permissions?.[k as keyof typeof emptyPermissions])
                      }
                      onCheckedChange={(checked) => {
                        const updated = {
                          canAddCamera: checked,
                          canEditCamera: checked,
                          canDeleteCamera: checked,
                          canRestartStream: checked,
                          canViewManagement: checked,
                          canPlayAudio: checked,
                          canViewStats: checked,
                          canControlPTZ: checked,
                          canViewPlayback: checked,
                          canViewEvents: checked,
                        };
                        setForm({ ...form, permissions: updated });
                      }}
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t("dashboardPermissions")}</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {[
                        { key: "canViewStats", label: t("allowStats") },
                      ].map((p) => (
                        <div key={p.key} className="flex items-center justify-between rounded-xl border border-border/40 p-2 bg-muted/10">
                          <Label className="text-[11px] font-normal cursor-pointer flex-1 text-foreground" htmlFor={`perm-${p.key}`}>{p.label}</Label>
                          <Switch 
                            id={`perm-${p.key}`}
                            checked={!!form.permissions?.[p.key as keyof typeof emptyPermissions]} 
                            onCheckedChange={(v) => setForm({ ...form, permissions: { ...form.permissions, [p.key]: v } as unknown as typeof emptyPermissions })} 
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 mt-1">{lang === "id" ? "Izin Monitoring" : "Monitoring Permissions"}</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {[
                        { key: "canViewPlayback", label: lang === "id" ? "Buka Halaman Playback" : "Access Playback Page" },
                        { key: "canViewEvents", label: lang === "id" ? "Buka Halaman Event" : "Access Smart Events Page" },
                      ].map((p) => (
                        <div key={p.key} className="flex items-center justify-between rounded-xl border border-border/40 p-2 bg-muted/10">
                          <Label className="text-[11px] font-normal cursor-pointer flex-1 text-foreground" htmlFor={`perm-${p.key}`}>{p.label}</Label>
                          <Switch 
                            id={`perm-${p.key}`}
                            checked={!!form.permissions?.[p.key as keyof typeof emptyPermissions]} 
                            onCheckedChange={(v) => setForm({ ...form, permissions: { ...form.permissions, [p.key]: v } as unknown as typeof emptyPermissions })} 
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 mt-1">{t("cameraManagementPermissions")}</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {[
                        { key: "canViewManagement", label: lang === "id" ? "Lihat Manajemen Kamera" : "View Camera Management" },
                        { key: "canAddCamera", label: t("addCamera") },
                        { key: "canEditCamera", label: t("editCamera") },
                        { key: "canDeleteCamera", label: t("deleteCameraTitle") },
                        { key: "canRestartStream", label: "Restart Stream" },
                        { key: "canControlPTZ", label: t("allowPTZ") },
                        { key: "canPlayAudio", label: t("allowAudio") },
                      ].map((p) => (
                        <div key={p.key} className="flex items-center justify-between rounded-xl border border-border/40 p-2 bg-muted/10">
                          <Label className="text-[11px] font-normal cursor-pointer flex-1 text-foreground" htmlFor={`perm-${p.key}`}>{p.label}</Label>
                          <Switch 
                            id={`perm-${p.key}`}
                            checked={!!form.permissions?.[p.key as keyof typeof emptyPermissions]} 
                            onCheckedChange={(v) => setForm({ ...form, permissions: { ...form.permissions, [p.key]: v } as unknown as typeof emptyPermissions })} 
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="shrink-0 border-t border-border/40 bg-muted/20 px-6 py-4">
            <Button variant="outline" className="border-border/40" onClick={() => setOpen(false)} disabled={saving}>{t("cancel")}</Button>
            <Button onClick={submit} disabled={saving}>{saving ? t("loading") : edit ? t("save") : t("add")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!del} onOpenChange={(o) => !o && setDel(null)}
        title={t("userDeleteConfirmTitle")}
        description={t("userDeleteConfirmDesc", { name: del?.username || "" })}
        confirmText={t("delete")} variant="destructive"
        onConfirm={async () => { 
          if (del) { 
            try { 
              await deleteUser(del.id); 
              toast.success(lang === "id" ? "Pengguna dihapus" : "User deleted"); 
              setDel(null); 
            } catch (err) { 
              toast.error(err instanceof Error ? err.message : "Failed to delete user"); 
            } 
          } 
        }}
      />
    </div>
  );
}
