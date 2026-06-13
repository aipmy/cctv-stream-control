import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import type { Camera, CameraInput, Brand, StreamType, SourceType, RtspTransport, HlsMode } from "@/types";
import { SOURCE_SUPPORTS_PTZ } from "@/types";
import { Info, Eye, EyeOff, Copy, Link2, Radio, TestTube2, Wand2, Activity, Check, ChevronsUpDown } from "lucide-react";
import { cameraApi, type PtzResult } from "@/lib/api";
import { useAuth } from "@/features/auth/store";
import { useCamerasQuery, useCameraActions } from "@/features/cameras/queries";
import { buildSourceUrl, buildOnvifUrl, buildRestreamUrl, DEFAULT_PORTS, defaultPath } from "@/lib/cctv";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  camera?: Camera | null;
}

const empty = {
  name: "",
  brand: "Universal" as Brand,
  ip: "",
  sourceType: "RTSP+ONVIF" as SourceType,
  rtspPort: 554,
  onvifPort: 80,
  httpPort: 80,
  sourcePath: defaultPath("RTSP+ONVIF"),
  username: "",
  password: "",
  site: "",
  streamType: "HLS Stable" as StreamType,
  rtspTransport: "tcp" as RtspTransport,
  hlsMode: "copy" as HlsMode,
  streamQuality: "Auto" as Camera["streamQuality"],
  audioMode: "Auto" as Camera["audioMode"],
  enablePTZ: false,
  enabled: true,
};

const sourceHelp: Record<SourceType, string> = {
  RTSP: "Stream H.264/H.265 standar. Tidak mendukung kontrol PTZ.",
  "RTSP+ONVIF": "RTSP untuk video + ONVIF untuk kontrol kamera. PTZ dapat diaktifkan jika kamera mendukungnya.",
  MJPEG: "Cocok untuk kamera lama / IP cam ringan. Tidak mendukung PTZ.",
  HLS: "Sumber HLS yang sudah ter-transcode. Hanya playback, tanpa PTZ.",
};

interface Preset {
  name: string;
  description: string;
  streamType: StreamType;
  rtspTransport: RtspTransport;
  hlsMode: HlsMode;
  audioMode: "Auto" | "Enable" | "Disable";
}

const PRESETS: Preset[] = [
  {
    name: "Ultra Performance (Copy)",
    description: "Sangat hemat CPU. Menggunakan stream H.264 asli tanpa audio. Latency sangat rendah.",
    streamType: "HLS Low Latency",
    rtspTransport: "tcp",
    hlsMode: "copy",
    audioMode: "Disable",
  },
  {
    name: "Compatibility (Transcode)",
    description: "Kompatibilitas browser tinggi. Transcode video ke H.264, audio dimatikan.",
    streamType: "HLS Stable",
    rtspTransport: "tcp",
    hlsMode: "transcode",
    audioMode: "Disable",
  },
  {
    name: "Full Stream + Audio",
    description: "Transcode video ke H.264 dengan audio menyala. Cocok untuk monitoring penuh.",
    streamType: "HLS Stable",
    rtspTransport: "tcp",
    hlsMode: "transcode",
    audioMode: "Enable",
  },
  {
    name: "Low Bandwidth (MJPEG)",
    description: "Streaming berbasis gambar berurutan. Sangat ringan untuk koneksi lambat.",
    streamType: "MJPEG",
    rtspTransport: "tcp",
    hlsMode: "copy",
    audioMode: "Disable",
  },
];

export function CameraFormDialog({ open, onOpenChange, camera }: Props) {
  const user = useAuth((s) => s.user);
  const { data: camerasData } = useCamerasQuery();
  const cameras = useMemo(() => camerasData || [], [camerasData]);
  const { addCamera, updateCamera } = useCameraActions();
  const siteOptions = useMemo(() => {
    const all = Array.from(new Set(cameras.map((c) => c.site).filter(Boolean)));
    if (user?.role !== "admin" && Array.isArray(user?.allowedGroups) && user.allowedGroups.length > 0) {
      return all.filter((s) => user.allowedGroups.includes(s)).sort((a, b) => a.localeCompare(b));
    }
    return all.sort((a, b) => a.localeCompare(b));
  }, [cameras, user]);

  const defaultSite = user?.role !== "admin" && user?.allowedGroups?.[0] ? user.allowedGroups[0] : "";
  const emptyWithSite = { ...empty, site: defaultSite };
  const [form, setForm] = useState(emptyWithSite);
  const activePresetIndex = PRESETS.findIndex(
    (p) =>
      p.streamType === form.streamType &&
      p.rtspTransport === form.rtspTransport &&
      p.hlsMode === form.hlsMode &&
      p.audioMode === form.audioMode
  );
  const activePresetValue = activePresetIndex !== -1 ? String(activePresetIndex) : "custom";

  const handlePresetChange = (v: string) => {
    if (v === "custom") return;
    const idx = Number(v);
    const p = PRESETS[idx];
    if (p) {
      setForm((f) => ({
        ...f,
        streamType: p.streamType,
        rtspTransport: p.rtspTransport,
        hlsMode: p.hlsMode,
        audioMode: p.audioMode,
      }));
    }
  };

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingPtz, setTestingPtz] = useState(false);
  const [ptzResult, setPtzResult] = useState<PtzResult | null>(null);

  const [probing, setProbing] = useState(false);
  const [probeDetectResult, setProbeDetectResult] = useState<{
    success: boolean;
    message: string;
    videoCodec?: string;
    audioCodec?: string;
    recommendedIndex?: number;
  } | null>(null);
  const [isNewSite, setIsNewSite] = useState(false);
  const [siteOpen, setSiteOpen] = useState(false);

  const runAutoDetect = async () => {
    if (!form.ip.trim()) {
      toast.error("IP / Host wajib diisi untuk melakukan deteksi");
      return;
    }
    setProbing(true);
    setProbeDetectResult(null);
    try {
      const payload: CameraInput = {
        name: form.name || "Test Probe",
        brand: form.brand,
        ip: form.ip,
        sourceType: form.sourceType,
        rtspPort: form.rtspPort,
        onvifPort: form.onvifPort,
        httpPort: form.httpPort,
        sourcePath: form.sourcePath,
        username: form.username,
        password: form.password,
        site: form.site || "Test",
        streamType: form.streamType,
        streamQuality: form.streamQuality,
        rtspTransport: form.rtspTransport,
        hlsMode: form.hlsMode,
        audioMode: form.audioMode,
        enablePTZ: form.enablePTZ,
        enabled: true,
      };
      
      const res = await cameraApi.probeTest(payload);
      if (res.probe && res.probe.ok) {
        const streams = res.probe.info?.streams || [];
        const videoStream = streams.find((s: { codec_type: string; codec_name?: string }) => s.codec_type === "video");
        const audioStream = streams.find((s: { codec_type: string; codec_name?: string }) => s.codec_type === "audio");
        
        const videoCodec = videoStream?.codec_name || "unknown";
        const audioCodec = audioStream?.codec_name || "none";
        
        let recIndex = 0;
        let explanation = "";
        
        if (videoCodec === "h264") {
          if (audioCodec === "aac") {
            recIndex = 2;
            explanation = "Kamera mengirimkan video H.264 dan audio AAC secara native. Rekomendasi: Gunakan preset 'Full Stream + Audio' (Anda juga bisa mengubah HLS Mode ke 'Copy' agar hemat CPU).";
          } else if (audioCodec === "none") {
            recIndex = 0;
            explanation = "Kamera menggunakan video H.264 standar tanpa audio. Rekomendasi: Gunakan preset 'Ultra Performance (Copy)' untuk performa terbaik dan hemat CPU.";
          } else {
            recIndex = 1;
            explanation = `Kamera menggunakan video H.264 standar, tetapi audio menggunakan codec '${audioCodec}' yang tidak didukung langsung oleh browser. Rekomendasi: Gunakan preset 'Compatibility (Transcode)' atau matikan audio.`;
          }
        } else if (videoCodec === "hevc" || videoCodec === "h265") {
          if (audioCodec === "none") {
            recIndex = 1;
            explanation = "Kamera menggunakan video H.265 (HEVC) yang tidak didukung langsung oleh sebagian besar browser. Rekomendasi: Gunakan preset 'Compatibility (Transcode)' agar video di-transcode ke H.264.";
          } else {
            recIndex = 2;
            explanation = `Kamera menggunakan video H.265 (HEVC) dan audio '${audioCodec}'. Rekomendasi: Gunakan preset 'Compatibility (Transcode)' atau 'Full Stream + Audio' agar video di-transcode ke format ramah browser (H.264).`;
          }
        } else {
          recIndex = 1;
          explanation = `Kamera menggunakan codec video '${videoCodec}' yang tidak dikenal. Rekomendasi: Gunakan preset 'Compatibility (Transcode)'.`;
        }
        
        setProbeDetectResult({
          success: true,
          message: explanation,
          videoCodec,
          audioCodec,
          recommendedIndex: recIndex,
        });
        toast.success("Deteksi codec berhasil!");
      } else {
        const errMsg = res.probe?.error || "Gagal menghubungi kamera.";
        setProbeDetectResult({
          success: false,
          message: `Gagal mendeteksi kamera. Error: ${errMsg}`,
        });
        toast.error("Deteksi codec gagal.");
      }
    } catch (err) {
      setProbeDetectResult({
        success: false,
        message: err instanceof Error ? err.message : "Terjadi kesalahan koneksi ke backend.",
      });
      toast.error("Gagal melakukan probe.");
    } finally {
      setProbing(false);
    }
  };

  const applyRecommendation = () => {
    if (probeDetectResult && probeDetectResult.recommendedIndex !== undefined) {
      const p = PRESETS[probeDetectResult.recommendedIndex];
      if (p) {
        setForm((f) => ({
          ...f,
          streamType: p.streamType,
          rtspTransport: p.rtspTransport,
          hlsMode: p.hlsMode,
          audioMode: p.audioMode,
        }));
        toast.success(`Preset '${p.name}' berhasil diterapkan!`);
      }
    }
  };

  useEffect(() => {
    if (camera) {
      const st = camera.sourceType ?? "RTSP+ONVIF";
      setForm({
        name: camera.name,
        brand: camera.brand || "Universal",
        ip: camera.ip,
        sourceType: st,
        rtspPort: camera.rtspPort ?? DEFAULT_PORTS[st]?.primary ?? 554,
        onvifPort: camera.onvifPort ?? DEFAULT_PORTS[st]?.onvif ?? 80,
        httpPort: camera.httpPort ?? DEFAULT_PORTS[st]?.primary ?? 80,
        sourcePath: camera.sourcePath ?? defaultPath(st),
        username: camera.username || "",
        password: camera.password || "",
        site: camera.site || "",
        streamType: camera.streamType,
        streamQuality: camera.streamQuality || "Auto",
        rtspTransport: camera.rtspTransport ?? "tcp",
        hlsMode: camera.hlsMode ?? "copy",
        audioMode: camera.audioMode ?? "Auto", enablePTZ: camera.enablePTZ,
        enabled: camera.enabled ?? true,
      });
    } else {
      setForm(empty);
    }
    setErrors({});
    setShowPassword(false);
    setPtzResult(null);
    setIsNewSite(false);
  }, [camera, open]);

  const ptzSupported = SOURCE_SUPPORTS_PTZ[form.sourceType];
  const isRtspFamily = form.sourceType === "RTSP" || form.sourceType === "RTSP+ONVIF";

  const handleSourceChange = (v: SourceType) => {
    setForm((f) => ({
      ...f,
      sourceType: v,
      rtspPort: DEFAULT_PORTS[v].primary === 554 ? 554 : f.rtspPort,
      httpPort: v === "HLS" ? 443 : 80,
      sourcePath: defaultPath(v),
      enablePTZ: SOURCE_SUPPORTS_PTZ[v] ? f.enablePTZ : false,
    }));
  };

  const sourceUrlPreview = useMemo(
    () => buildSourceUrl(form, { maskPassword: !showPassword }),
    [form, showPassword]
  );
  const onvifUrlPreview = useMemo(() => buildOnvifUrl(form), [form]);
  const restreamUrl = useMemo(
    () => buildRestreamUrl({ id: camera?.id ?? "preview", streamType: form.streamType }),
    [camera?.id, form.streamType]
  );

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Nama wajib diisi";
    if (!form.ip.trim()) e.ip = "IP/Host wajib diisi";
    if (!form.site.trim()) e.site = "Site/group wajib diisi";
    if (!form.sourcePath.trim()) e.sourcePath = "Path wajib diisi";
    if (isRtspFamily && (!form.rtspPort || form.rtspPort < 1)) e.rtspPort = "Port RTSP tidak valid";
    if (form.sourceType === "RTSP+ONVIF" && (!form.onvifPort || form.onvifPort < 1)) e.onvifPort = "Port ONVIF tidak valid";
    if (!isRtspFamily && (!form.httpPort || form.httpPort < 1)) e.httpPort = "Port tidak valid";
    if (Object.keys(e).length) { setErrors(e); return; }

    const payload: CameraInput = {
      name: form.name,
      brand: form.brand,
      ip: form.ip,
      sourceType: form.sourceType,
      rtspPort: form.rtspPort,
      onvifPort: form.onvifPort,
      httpPort: form.httpPort,
      sourcePath: form.sourcePath.startsWith("/") ? form.sourcePath : `/${form.sourcePath}`,
      username: form.username,
      site: form.site,
      streamType: form.streamType,
      streamQuality: form.streamQuality,
      rtspTransport: form.rtspTransport,
      hlsMode: form.hlsMode,
      audioMode: form.audioMode,
      enablePTZ: form.enablePTZ,
      enabled: form.enabled,
      ...(form.password ? { password: form.password } : {}),
    };

    setSaving(true);
    try {
      if (camera) {
        await updateCamera(camera.id, payload);
        toast.success("Kamera berhasil diperbarui");
      } else {
        await addCamera(payload);
        toast.success("Kamera baru ditambahkan");
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan kamera");
    } finally {
      setSaving(false);
    }
  };

  const testPtz = async () => {
    if (!camera) return;
    setTestingPtz(true);
    setPtzResult(null);
    try {
      const result = await cameraApi.testPtz(camera.id);
      setPtzResult(result);
      toast.success(`ONVIF terhubung via ${result.mode || "standard"}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Uji ONVIF/PTZ gagal");
    } finally {
      setTestingPtz(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[min(90vh,850px)] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="shrink-0 border-b px-6 py-5 pr-12">
          <DialogTitle>{camera ? "Edit Kamera" : "Tambah Kamera"}</DialogTitle>
          <DialogDescription>Konfigurasi koneksi dan stream untuk kamera CCTV.</DialogDescription>
        </DialogHeader>

        <div data-testid="camera-form-scroll" className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Nama Kamera" error={errors.name}>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Lobby 01" />
          </Field>
          <Field label="Brand">
            <Select value={form.brand} onValueChange={(v) => setForm({ ...form, brand: v as Brand })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Universal", "Bardi", "EZVIZ", "Hikvision"].map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="IP / Host" error={errors.ip}>
            <Input value={form.ip} onChange={(e) => setForm({ ...form, ip: e.target.value })} placeholder="192.168.1.10" />
          </Field>
          <Field label="Site / Group" error={errors.site}>
            {user?.role !== "admin" && Array.isArray(user?.allowedGroups) && user.allowedGroups.length > 0 ? (
              <Popover open={siteOpen} onOpenChange={setSiteOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" aria-expanded={siteOpen} className="w-full justify-between font-normal">
                    {form.site || "Pilih site"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0">
                  <Command>
                    <CommandInput placeholder="Cari site..." />
                    <CommandList>
                      <CommandEmpty>Tidak ada site ditemukan.</CommandEmpty>
                      <CommandGroup>
                        {user.allowedGroups.map((g) => (
                          <CommandItem
                            key={g}
                            value={g}
                            onSelect={(v) => {
                              setForm({ ...form, site: v });
                              setSiteOpen(false);
                            }}
                          >
                            <Check className={cn("mr-2 h-4 w-4", form.site === g ? "opacity-100" : "opacity-0")} />
                            {g}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            ) : (
              <div className="space-y-2">
                {!isNewSite ? (
                  <Popover open={siteOpen} onOpenChange={setSiteOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" role="combobox" aria-expanded={siteOpen} className="w-full justify-between font-normal">
                        {form.site || "Pilih site"}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-full p-0">
                      <Command>
                        <CommandInput placeholder="Cari site..." />
                        <CommandList>
                          <CommandEmpty>Tidak ada site ditemukan.</CommandEmpty>
                          <CommandGroup>
                            {siteOptions.map((s) => (
                              <CommandItem
                                key={s}
                                value={s}
                                onSelect={(v) => {
                                  setForm({ ...form, site: v });
                                  setSiteOpen(false);
                                }}
                              >
                                <Check className={cn("mr-2 h-4 w-4", form.site === s ? "opacity-100" : "opacity-0")} />
                                {s}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                          <CommandGroup>
                            <CommandItem
                              value="___new___"
                              className="text-primary font-medium"
                              onSelect={() => {
                                setIsNewSite(true);
                                setForm({ ...form, site: "" });
                                setSiteOpen(false);
                              }}
                            >
                              + Tambah Site Baru...
                            </CommandItem>
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                ) : (
                  <div className="flex gap-2">
                    <Input
                      value={form.site}
                      onChange={(e) => setForm({ ...form, site: e.target.value })}
                      placeholder="Ketik nama site baru"
                      className="flex-1"
                      autoFocus
                    />
                    <Button variant="outline" size="sm" type="button" onClick={() => setIsNewSite(false)}>Batal</Button>
                  </div>
                )}
              </div>
            )}
          </Field>

          <Field label="Stream Source" className="md:col-span-2">
            <Select value={form.sourceType} onValueChange={(v) => handleSourceChange(v as SourceType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="RTSP">RTSP — video saja</SelectItem>
                <SelectItem value="RTSP+ONVIF">RTSP + ONVIF — mendukung PTZ</SelectItem>
                <SelectItem value="MJPEG">MJPEG — kamera ringan / lawas</SelectItem>
                <SelectItem value="HLS">HLS — sumber sudah ter-transcode</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1.5 flex items-start gap-1.5">
              <Info className="h-3 w-3 mt-0.5 shrink-0" />
              <span>{sourceHelp[form.sourceType]}</span>
            </p>
          </Field>

          {isRtspFamily ? (
            <>
              <Field label="RTSP Port" error={errors.rtspPort}>
                <Input type="number" min={1} max={65535} value={form.rtspPort}
                  onChange={(e) => setForm({ ...form, rtspPort: Number(e.target.value) })} placeholder="554" />
              </Field>
              {form.sourceType === "RTSP+ONVIF" ? (
                <Field label="ONVIF Port" error={errors.onvifPort}>
                  <Input type="number" min={1} max={65535} value={form.onvifPort}
                    onChange={(e) => setForm({ ...form, onvifPort: Number(e.target.value) })} placeholder="80" />
                </Field>
              ) : (
                <div />
              )}
            </>
          ) : (
            <Field label={form.sourceType === "HLS" ? "HTTP(S) Port" : "HTTP Port"} error={errors.httpPort}>
              <Input type="number" min={1} max={65535} value={form.httpPort}
                onChange={(e) => setForm({ ...form, httpPort: Number(e.target.value) })}
                placeholder={form.sourceType === "HLS" ? "443" : "80"} />
            </Field>
          )}

          <Field label="Stream Path" className="md:col-span-2" error={errors.sourcePath}>
            <Input
              value={form.sourcePath}
              onChange={(e) => setForm({ ...form, sourcePath: e.target.value })}
              placeholder={defaultPath(form.sourceType)}
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Path saja (tanpa protokol/host). Contoh: <code>/Streaming/Channels/101</code>
            </p>
          </Field>

          <Field label="Username">
            <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="off" />
          </Field>
          <Field label="Password">
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                value={form.password}
                onChange={(e) => {
                  setForm({ ...form, password: e.target.value });
                }}
                autoComplete="new-password"
                className="pr-9"
              />
              <Button
                type="button" size="icon" variant="ghost"
                className="absolute right-0 top-0 h-full w-9 hover:bg-transparent text-muted-foreground hover:text-foreground"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            {camera?.hasPassword && !form.password && (
              <p className="text-[11px] text-muted-foreground mt-1">Password tersimpan. Kosongkan untuk tetap menggunakan password lama.</p>
            )}
          </Field>

          <div className="md:col-span-2 border-t pt-4 mt-2">
            <h3 className="text-sm font-semibold tracking-tight">Pengaturan Stream & Preset</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Pilih preset cepat atau lakukan auto-detect untuk konfigurasi streaming yang optimal.</p>
          </div>

          <Field label="Stream Preset (Rekomendasi)" className="md:col-span-2">
            <div className="flex gap-2">
              <div className="flex-1">
                <Select value={activePresetValue} onValueChange={handlePresetChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRESETS.map((p, idx) => (
                      <SelectItem key={idx} value={String(idx)}>
                        {p.name}
                      </SelectItem>
                    ))}
                    <SelectItem value="custom">Kustom (Ubah manual)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={runAutoDetect}
                disabled={probing}
                className="shrink-0 flex gap-1.5"
              >
                <Activity className={cn("h-4 w-4", probing && "animate-pulse")} />
                {probing ? "Mendeteksi..." : "Deteksi Codec"}
              </Button>
            </div>
            {activePresetIndex !== -1 && (
              <p className="text-[11px] text-muted-foreground mt-1.5">
                {PRESETS[activePresetIndex].description}
              </p>
            )}
          </Field>

          {probeDetectResult && (
            <div className={cn(
              "md:col-span-2 rounded-md border p-3.5 space-y-2 text-xs",
              probeDetectResult.success ? "bg-success/5 border-success/30" : "bg-destructive/5 border-destructive/30"
            )}>
              <div className="flex items-center justify-between">
                <div className="font-semibold flex items-center gap-1.5">
                  <Wand2 className="h-4 w-4 text-primary" />
                  Hasil Deteksi Kamera
                </div>
                {probeDetectResult.success && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={applyRecommendation}
                    className="h-7 text-[11px] bg-gradient-primary hover:opacity-90 text-primary-foreground font-medium"
                  >
                    Terapkan Rekomendasi
                  </Button>
                )}
              </div>
              {probeDetectResult.success ? (
                <div className="space-y-1 mt-1">
                  <div className="grid grid-cols-2 gap-2 font-mono text-[11px] bg-muted/30 p-2 rounded">
                    <div>Codec Video: <span className="font-bold text-primary">{probeDetectResult.videoCodec}</span></div>
                    <div>Codec Audio: <span className="font-bold text-primary">{probeDetectResult.audioCodec}</span></div>
                  </div>
                  <p className="text-muted-foreground mt-2 leading-relaxed">{probeDetectResult.message}</p>
                </div>
              ) : (
                <p className="text-destructive font-mono mt-1 leading-relaxed">{probeDetectResult.message}</p>
              )}
            </div>
          )}

          <div className="md:col-span-2 grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Output Format</Label>
              <Select value={form.streamType} onValueChange={(v) => setForm({ ...form, streamType: v as StreamType })}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="HLS Stable">HLS Stable (Compatible)</SelectItem>
                  <SelectItem value="HLS Low Latency">HLS Low Latency</SelectItem>
                  <SelectItem value="MJPEG">MJPEG (Legacy)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Stream Quality</Label>
              <Select value={form.streamQuality} onValueChange={(v) => setForm({ ...form, streamQuality: v as Camera["streamQuality"] })}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Auto">Auto (Original)</SelectItem>
                  <SelectItem value="1080p">1080p</SelectItem>
                  <SelectItem value="720p">720p</SelectItem>
                  <SelectItem value="480p">480p</SelectItem>
                  <SelectItem value="360p">360p</SelectItem>
                  <SelectItem value="144p">144p</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {isRtspFamily && (
            <Field label="RTSP Transport">
              <Select value={form.rtspTransport} onValueChange={(v) => setForm({ ...form, rtspTransport: v as RtspTransport })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="tcp">TCP — paling stabil</SelectItem>
                  <SelectItem value="udp">UDP — latency rendah</SelectItem>
                  <SelectItem value="auto">Auto — default FFmpeg</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">Untuk kamera yang VLC/FFmpeg manual jalan dengan TCP, pilih TCP.</p>
            </Field>
          )}

          {form.streamType !== "MJPEG" && isRtspFamily && (
            <Field label="HLS Mode">
              <Select value={form.hlsMode} onValueChange={(v) => setForm({ ...form, hlsMode: v as HlsMode })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="copy">Copy — ringan, sesuai command manual</SelectItem>
                  <SelectItem value="transcode">Transcode — kompatibel, CPU lebih berat</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">Copy memakai -vcodec copy. Transcode memakai libx264 browser-friendly.</p>
            </Field>
          )}

          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="min-w-0 pr-2">
              <Label className="text-sm">Kamera Aktif</Label>
              <p className="text-[11px] text-muted-foreground mt-0.5">Status online/offline dihitung otomatis dari probe/stream.</p>
            </div>
            <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-sm">Pengaturan Audio</Label>
            <Select value={form.audioMode} onValueChange={(v) => setForm({ ...form, audioMode: v as Camera["audioMode"] })}>
              <SelectTrigger className="w-[120px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Auto">Auto</SelectItem>
                <SelectItem value="Enable">Enable</SelectItem>
                <SelectItem value="Disable">Disable</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className={cn("flex items-center justify-between rounded-md border p-3", !ptzSupported && "opacity-60")}>
            <div className="min-w-0 pr-2">
              <Label className="text-sm">Aktifkan PTZ</Label>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {ptzSupported ? "Sumber mendukung ONVIF — kontrol PTZ tersedia." : "Hanya tersedia untuk sumber RTSP + ONVIF."}
              </p>
            </div>
            <Switch checked={form.enablePTZ} disabled={!ptzSupported}
              onCheckedChange={(v) => setForm({ ...form, enablePTZ: v })} />
          </div>

          <div className="md:col-span-2 rounded-md border bg-muted/30 p-3 space-y-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Pratinjau URL</div>
            <UrlRow icon={<Link2 className="h-3.5 w-3.5" />} label="Source Asli" value={sourceUrlPreview} tone="primary" />
            {form.sourceType === "RTSP+ONVIF" && (
              <UrlRow icon={<Link2 className="h-3.5 w-3.5" />} label="ONVIF Endpoint" value={onvifUrlPreview} />
            )}
            <UrlRow icon={<Radio className="h-3.5 w-3.5" />} label={`Restream (${form.streamType})`} value={restreamUrl} tone="success" />
          </div>

          {camera && form.sourceType === "RTSP+ONVIF" && form.enablePTZ && (
            <div className="md:col-span-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">Diagnostik ONVIF/PTZ</div>
                  <p className="text-[11px] text-muted-foreground">Pengujian memakai konfigurasi terakhir yang sudah disimpan.</p>
                </div>
                <Button type="button" variant="outline" onClick={testPtz} disabled={testingPtz}>
                  <TestTube2 className="h-4 w-4" />
                  {testingPtz ? "Menguji..." : "Test ONVIF/PTZ"}
                </Button>
              </div>
              {ptzResult && (
                <div className="mt-3 grid gap-1 text-xs font-mono">
                  <div>mode: {ptzResult.mode || "standard"}</div>
                  <div>profiles: {ptzResult.profiles ?? 0}</div>
                  <div>profile token: {ptzResult.profileToken || "-"}</div>
                  {ptzResult.warning && (
                    <div className="text-warning">warning [{ptzResult.warning.code}]: {ptzResult.warning.message}</div>
                  )}
                </div>
              )}
            </div>
          )}

        </div>
        </div>

        <DialogFooter data-testid="camera-form-footer" className="shrink-0 border-t bg-background px-6 py-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Menyimpan…" : camera ? "Simpan" : "Tambah"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, error, children, className }: { label: string; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      <div className="mt-1.5">{children}</div>
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  );
}

function UrlRow({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone?: "primary" | "success" }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} disalin`);
    } catch {
      toast.error("Gagal menyalin");
    }
  };
  return (
    <div className="flex items-center gap-2">
      <div className={cn(
        "h-6 w-6 rounded flex items-center justify-center shrink-0",
        tone === "primary" && "bg-primary/15 text-primary",
        tone === "success" && "bg-success/15 text-success",
        !tone && "bg-muted text-muted-foreground"
      )}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="font-mono text-[11px] truncate" title={value}>{value}</div>
      </div>
      <Button type="button" size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={copy} aria-label={`Salin ${label}`}>
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
