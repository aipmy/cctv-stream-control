import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordStrengthMeter } from "@/components/PasswordStrengthMeter";
import { useAuth } from "./store";

export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const changePassword = useAuth((state) => state.changePassword);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentPassword || !newPassword) {
      toast.error("Password saat ini dan password baru wajib diisi");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Konfirmasi password baru tidak sama");
      return;
    }
    setSaving(true);
    try {
      await changePassword(currentPassword, newPassword);
      toast.success("Password berhasil diubah");
      close(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Password gagal diubah");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Ubah password</DialogTitle>
            <DialogDescription>
              Masukkan password saat ini sebelum membuat password baru.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-5">
            <div>
              <Label htmlFor="current-password">Password saat ini</Label>
              <Input
                id="current-password"
                className="mt-1.5"
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoComplete="current-password"
              />
            </div>
            <div>
              <Label htmlFor="new-password">Password baru</Label>
              <Input
                id="new-password"
                className="mt-1.5"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
              />
              <PasswordStrengthMeter password={newPassword} />
            </div>
            <div>
              <Label htmlFor="confirm-new-password">Konfirmasi password baru</Label>
              <Input
                id="confirm-new-password"
                className="mt-1.5"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => close(false)} disabled={saving}>
              Batal
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Menyimpan..." : "Ubah password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
