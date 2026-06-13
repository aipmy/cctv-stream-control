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
import { Plus, Pencil, Trash2, ScrollText, Loader2, Download, Trash } from "lucide-react";
import type { AuditOutcome, CreateUserInput, Role, UserSummary } from "@/types";
import { auditApi } from "@/lib/api";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PasswordStrengthMeter } from "@/components/PasswordStrengthMeter";

const roleColors: Record<Role, string> = {
  admin: "bg-primary/15 text-primary border-primary/30",
  teknisi: "bg-info/15 text-info border-info/30",
  guest: "bg-muted text-muted-foreground border-border",
};

function formatLastLogin(iso: string) {
  const d = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (d < 60) return "Baru saja";
  if (d < 3600) return `${Math.floor(d / 60)} menit lalu`;
  if (d < 86400) return `${Math.floor(d / 3600)} jam lalu`;
  if (d < 172800) return `Kemarin ${new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`;
  return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

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
  const emptyPermissions = { canAddCamera: false, canEditCamera: false, canDeleteCamera: false, canRestartStream: false, canViewManagement: false };
  const [form, setForm] = useState<CreateUserInput>({ username: "", password: "", role: "guest", active: true, permissions: emptyPermissions, allowedGroups: [] });
  const [saving, setSaving] = useState(false);
  const [auditActor, setAuditActor] = useState("");
  const [auditAction, setAuditAction] = useState("");
  const [auditOutcome, setAuditOutcome] = useState<AuditOutcome | "all">("all");
  const auditFilters = useMemo(() => ({
    limit: 50,
    actor: auditActor.trim() || undefined,
    action: auditAction.trim() || undefined,
    outcome: auditOutcome,
  }), [auditAction, auditActor, auditOutcome]);
  const audit = useAuditQuery(auditFilters, role === "admin");
  const auditItems = audit.data?.pages.flatMap((page) => page.items) || [];

  if (role !== "admin") return <Navigate to="/" replace />;

  const openNew = () => { setEdit(null); setForm({ username: "", password: "", role: "guest", active: true, permissions: emptyPermissions, allowedGroups: [] }); setOpen(true); };
  const openEdit = (u: UserSummary) => {
    setEdit(u);
    setForm({ username: u.username, password: "", role: u.role, active: u.active, permissions: u.permissions || emptyPermissions, allowedGroups: u.allowedGroups || [] });
    setOpen(true);
  };

  const submit = async () => {
    if (!form.username.trim()) return toast.error("Username wajib diisi");
    if (!edit && !form.password.trim()) return toast.error("Password wajib diisi untuk pengguna baru");
    setSaving(true);
    try {
      if (edit) { await updateUser(edit.id, form); toast.success("Pengguna diperbarui"); }
      else { await addUser(form); toast.success("Pengguna ditambahkan"); }
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan pengguna");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Manajemen Pengguna</h1>
          <p className="text-sm text-muted-foreground">Kelola akun operator dan hak akses.</p>
        </div>
        <Button onClick={openNew} className="bg-gradient-primary text-primary-foreground hover:opacity-95">
          <Plus className="h-4 w-4" /> Tambah Pengguna
        </Button>
      </div>

      <div className="grid md:grid-cols-[1fr_350px] gap-5 items-start">
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Login</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.username}</TableCell>
                <TableCell><Badge variant="outline" className={roleColors[u.role]}>{u.role}</Badge></TableCell>
                <TableCell>
                  <Switch
                    checked={u.active}
                    onCheckedChange={async (v) => {
                      try {
                        await updateUser(u.id, { active: v });
                        toast.success(`Pengguna ${v ? "diaktifkan" : "dinonaktifkan"}`);
                      } catch (err) {
                        toast.error("Gagal mengubah status pengguna");
                      }
                    }}
                  />
                </TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {u.lastLoginAt ? formatLastLogin(u.lastLoginAt) : <span className="text-muted-foreground/50">Belum pernah</span>}
                </TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(u)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDel(u)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
            </Table>
          </Card>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold flex items-center"><ScrollText className="mr-1.5 h-4 w-4" /> Recent Activity</h2>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => window.open(auditApi.exportUrl(), "_blank")}><Download className="h-3 w-3 mr-1.5" /> Export</Button>
          </div>
          <Card className="flex flex-col h-[500px]">
            <div className="p-3 border-b space-y-2">
              <Input
                value={auditActor}
                onChange={(event) => setAuditActor(event.target.value)}
                placeholder="Filter actor/username"
                className="h-8 text-xs"
              />
              <Select value={auditOutcome} onValueChange={(value) => setAuditOutcome(value as AuditOutcome | "all")}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua hasil</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Waktu</TableHead>
                    <TableHead>Actor/Action</TableHead>
                    <TableHead>Hasil</TableHead>
                  </TableRow>
                </TableHeader>
              <TableBody>
                {auditItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="whitespace-nowrap text-[10px] text-muted-foreground">{new Date(item.ts).toLocaleTimeString("id-ID")}</TableCell>
                    <TableCell>
                      <div className="text-xs font-medium truncate max-w-[120px]">{item.actor.username}</div>
                      <div className="text-[10px] text-muted-foreground font-mono truncate max-w-[120px]">{item.action}</div>
                    </TableCell>
                    <TableCell><AuditOutcomeBadge outcome={item.outcome} /></TableCell>
                  </TableRow>
                ))}
                  {!audit.isPending && auditItems.length === 0 && (
                    <TableRow><TableCell colSpan={3} className="py-12 text-center text-sm text-muted-foreground">Belum ada audit log.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
              {audit.isPending && <div className="flex items-center justify-center p-8 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Memuat...</div>}
              {audit.isError && <div className="p-4 text-sm text-destructive">{audit.error instanceof Error ? audit.error.message : "Gagal memuat log"}</div>}
              {audit.hasNextPage && (
                <div className="border-t p-3 text-center">
                  <Button variant="outline" size="sm" onClick={() => void audit.fetchNextPage()} disabled={audit.isFetchingNextPage}>
                    {audit.isFetchingNextPage ? "Memuat..." : "Muat lebih lama"}
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] gap-0 overflow-hidden p-0 flex flex-col">
          <DialogHeader className="shrink-0 border-b px-6 py-5 pr-12">
            <DialogTitle>{edit ? "Edit Pengguna" : "Tambah Pengguna"}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
            <div>
              <Label className="text-xs uppercase tracking-wider">Username</Label>
              <Input className="mt-1.5" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider">Password</Label>
              <Input className="mt-1.5" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
              <PasswordStrengthMeter password={form.password} />
              {edit && <p className="mt-1 text-xs text-muted-foreground">Kosongkan jika password tidak diubah.</p>}
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider">Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as Role })}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="teknisi">Teknisi</SelectItem>
                  <SelectItem value="guest">Guest</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <Label className="text-sm">Status Aktif</Label>
              <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
            </div>
            
            {form.role !== "admin" && (
              <div className="space-y-4 pt-4 border-t mt-4">
                <div>
                  <Label className="text-xs uppercase tracking-wider block mb-3">Group/Site yang diizinkan</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 border rounded-md p-3 max-h-48 overflow-y-auto">
                    {siteOptions.length === 0 && <div className="text-xs text-muted-foreground col-span-full">Belum ada site.</div>}
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
                        <label htmlFor={`site-${site}`} className="text-xs font-medium leading-none cursor-pointer">
                          {site}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>

                <Label className="text-xs uppercase tracking-wider block mt-4 mb-2">Izin Spesifik</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    { key: "canAddCamera", label: "Tambah Kamera" },
                    { key: "canEditCamera", label: "Edit Kamera" },
                    { key: "canDeleteCamera", label: "Hapus Kamera" },
                    { key: "canRestartStream", label: "Restart Stream" },
                    { key: "canViewManagement", label: "Lihat Manajemen Kamera" }
                  ].map((p) => (
                    <div key={p.key} className="flex items-center justify-between rounded-md border p-2">
                      <Label className="text-xs font-normal">{p.label}</Label>
                      <Switch 
                        checked={!!form.permissions?.[p.key as keyof typeof emptyPermissions]} 
                        onCheckedChange={(v) => setForm({ ...form, permissions: { ...form.permissions, [p.key]: v } as unknown as typeof emptyPermissions })} 
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="shrink-0 border-t bg-background px-6 py-4">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>Batal</Button>
            <Button onClick={submit} disabled={saving}>{saving ? "Menyimpan..." : edit ? "Simpan" : "Tambah"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!del} onOpenChange={(o) => !o && setDel(null)}
        title="Hapus pengguna?"
        description={`Akun "${del?.username}" akan dihapus permanen.`}
        confirmText="Hapus" variant="destructive"
        onConfirm={async () => { if (del) { try { await deleteUser(del.id); toast.success("Pengguna dihapus"); setDel(null); } catch (err) { toast.error(err instanceof Error ? err.message : "Gagal menghapus pengguna"); } } }}
      />
    </div>
  );
}

function AuditOutcomeBadge({ outcome }: { outcome: AuditOutcome }) {
  const className = outcome === "success"
    ? "border-success/30 text-success"
    : outcome === "warning"
      ? "border-warning/30 text-warning"
      : "border-destructive/30 text-destructive";
  return <Badge variant="outline" className={className}>{outcome}</Badge>;
}
