import { useSettings } from "@/features/settings/store";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Moon, Sun, Grid3x3, RefreshCw, Radio, Cctv as CctvIcon } from "lucide-react";
import type { StreamType } from "@/types";

export default function Settings() {
  const { settings, setSettings } = useSettings();

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Pengaturan Tampilan</h1>
        <p className="text-sm text-muted-foreground">Personalisasi tampilan dan perilaku dashboard.</p>
      </div>

      <Card className="p-5 space-y-1">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-md bg-primary/10 text-primary flex items-center justify-center">
              {settings.theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </div>
            <div>
              <Label className="font-medium">Mode Tema</Label>
              <p className="text-xs text-muted-foreground">Dark mode disarankan untuk ruang monitoring.</p>
            </div>
          </div>
          <Switch checked={settings.theme === "dark"} onCheckedChange={(v) => setSettings({ theme: v ? "dark" : "light" })} />
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex items-start gap-3 mb-4">
          <div className="h-9 w-9 rounded-md bg-info/10 text-info flex items-center justify-center"><Grid3x3 className="h-4 w-4" /></div>
          <div>
            <Label className="font-medium">Grid Kamera per Baris</Label>
            <p className="text-xs text-muted-foreground">Jumlah kolom kamera pada dashboard.</p>
          </div>
        </div>
        <RadioGroup
          value={String(settings.gridCols)}
          onValueChange={(v) => setSettings({ gridCols: Number(v) as 1 | 2 | 3 | 4 | 5 | 6 })}
          className="grid grid-cols-3 md:grid-cols-6 gap-2"
        >
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <Label
              key={n}
              htmlFor={`grid-${n}`}
              className="cursor-pointer rounded-md border p-3 flex flex-col items-center gap-1 hover:border-primary/60 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 transition-colors"
            >
              <RadioGroupItem id={`grid-${n}`} value={String(n)} className="sr-only" />
              <span className="text-lg font-semibold">{n}</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">kolom</span>
            </Label>
          ))}
        </RadioGroup>
      </Card>

      <Card className="p-5">
        <div className="flex items-start gap-3 mb-4">
          <div className="h-9 w-9 rounded-md bg-primary/10 text-primary flex items-center justify-center"><CctvIcon className="h-4 w-4" /></div>
          <div>
            <Label className="font-medium">Kamera per Halaman</Label>
            <p className="text-xs text-muted-foreground">Membatasi jumlah stream yang dibuka bersamaan.</p>
          </div>
        </div>
        <RadioGroup
          value={String(settings.pageSize)}
          onValueChange={(v) => setSettings({ pageSize: Number(v) as 1 | 2 | 3 | 4 | 5 | 6 })}
          className="grid grid-cols-3 md:grid-cols-6 gap-2"
        >
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <Label
              key={n}
              htmlFor={`page-size-${n}`}
              className="cursor-pointer rounded-md border p-3 flex flex-col items-center gap-1 hover:border-primary/60 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 transition-colors"
            >
              <RadioGroupItem id={`page-size-${n}`} value={String(n)} className="sr-only" />
              <span className="text-lg font-semibold">{n}</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">kamera</span>
            </Label>
          ))}
        </RadioGroup>
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-md bg-warning/10 text-warning flex items-center justify-center"><RefreshCw className="h-4 w-4" /></div>
            <div>
              <Label className="font-medium">Auto Refresh Statistik</Label>
              <p className="text-xs text-muted-foreground">Perbarui status, viewer, dan metrik kamera setiap 1 detik.</p>
            </div>
          </div>
          <Switch checked={settings.autoRefresh} onCheckedChange={(v) => setSettings({ autoRefresh: v })} />
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex items-start gap-3 mb-3">
          <div className="h-9 w-9 rounded-md bg-success/10 text-success flex items-center justify-center"><Radio className="h-4 w-4" /></div>
          <div className="flex-1">
            <Label className="font-medium">Stream Output Default</Label>
            <p className="text-xs text-muted-foreground">Digunakan saat kamera baru ditambahkan.</p>
          </div>
        </div>
        <Select value={settings.defaultStream} onValueChange={(v) => setSettings({ defaultStream: v as StreamType })}>
          <SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="HLS Stable">HLS Stable</SelectItem>
            <SelectItem value="HLS Low Latency">HLS Low Latency</SelectItem>
            <SelectItem value="MJPEG">MJPEG</SelectItem>
          </SelectContent>
        </Select>
      </Card>
    </div>
  );
}
