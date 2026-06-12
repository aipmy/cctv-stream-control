import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setupApi } from "@/lib/api";
import { useAuth } from "./store";
import { PasswordStrengthMeter } from "@/components/PasswordStrengthMeter";

export function SetupPage() {
  const queryClient = useQueryClient();
  const setSession = useAuth((state) => state.setSession);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password) {
      toast.error("Username dan password wajib diisi");
      return;
    }
    if (password !== confirm) {
      toast.error("Konfirmasi password tidak sama");
      return;
    }

    setSaving(true);
    try {
      const result = await setupApi.createAdmin(username.trim(), password);
      setSession(result.user, result.token);
      queryClient.setQueryData(["setup-status"], { required: false });
      toast.success("Administrator pertama berhasil dibuat");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Setup gagal");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md p-6">
        <div className="h-11 w-11 rounded-md bg-primary/10 text-primary flex items-center justify-center">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">Buat akun administrator</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Instalasi ini belum memiliki pengguna. Akun pertama selalu dibuat dengan role admin.
        </p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <Label>Username</Label>
            <Input
              className="mt-1.5"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoFocus
              autoComplete="username"
            />
          </div>
          <div>
            <Label>Password</Label>
            <Input
              className="mt-1.5"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
            />
            <PasswordStrengthMeter password={password} />
          </div>
          <div>
            <Label>Konfirmasi password</Label>
            <Input
              className="mt-1.5"
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="new-password"
            />
          </div>
          <Button className="w-full" type="submit" disabled={saving}>
            {saving ? "Membuat akun..." : "Buat administrator"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
