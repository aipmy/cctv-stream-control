import { useEffect, useMemo, useState, useRef } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectGroup, SelectLabel, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import type { Camera, CameraInput, Brand, StreamType, SourceType, MotionArea } from "@/types";
import { SOURCE_SUPPORTS_PTZ, DEFAULT_PORTS } from "@/types";
import { Info, Eye, EyeOff, Copy, Link2, Radio, TestTube2, Check, ChevronsUpDown, ExternalLink, Clock } from "lucide-react";
import { cameraApi, type PtzResult } from "@/lib/api";
import { useAuth } from "@/features/auth/store";
import { useCamerasQuery, useCameraActions } from "@/features/cameras/queries";
import { buildStreamUrl, buildOnvifUrl, buildRestreamUrl, defaultPath } from "@/lib/cctv";
import { CameraLiveView } from "./CameraLiveView";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslation, type TranslationKey } from "@/hooks/useTranslation";
import { SmartDetectionEditor } from "./SmartDetectionEditor";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  camera?: Camera | null;
}

const empty = {
  name: "",
  brand: "Universal" as Brand,
  ip: "",
  port: 80,
  sourceType: "ONVIF" as SourceType,
  streamPath: "",
  customUrl: "",
  username: "",
  password: "",
  site: "",
  streamType: "webrtc,mse,hls,mjpeg" as StreamType,
  audioMode: "Auto" as Camera["audioMode"],
  enablePTZ: false,
  enabled: true,
  enableRecording: false,
  enableNotifications: false,
  enableSmartDetection: undefined as boolean | undefined,
  motionSensitivity: 50,
  motionArea: null as MotionArea | null,
  excludeAreas: [] as MotionArea[],
  detectionModes: ["pixel", "human", "pet"] as string[],
  detectResolution: "480p" as Camera["detectResolution"],
  enableSoundDetection: false,
  recordingMode: "continuous",
  recordMode: "" as Camera["recordMode"],
  recordResolution: "Auto" as Camera["recordResolution"],
  aiSensitivity: 50,
  detectFps: 6,
};

const SOURCE_LABELS: Record<SourceType, string> = {
  ONVIF: "ONVIF (Recommended)",
  RTSP: "RTSP",
  DVRIP: "DVRIP / XMeye",
  HomeAssistant: "Home Assistant",
  Custom: "Custom URL",
};

const SOURCE_HELP: Record<SourceType, string> = {
  ONVIF: "Auto-detect stream, PTZ support, audio 2-way. Cocok untuk Hikvision, Bardi, Reolink, dll.",
  RTSP: "Koneksi RTSP langsung. Perlu path manual (contoh: /Streaming/Channels/101).",
  DVRIP: "Protokol DVR China / XMeye. Cukup IP & port.",
  HomeAssistant: "Integrasi dengan Home Assistant camera entities.",
  Custom: "Masukkan URL go2rtc apapun: rtsp://, onvif://, ffmpeg://, http://, dll.",
};

export function CameraFormDialog({ open, onOpenChange, camera }: Props) {
  const { t } = useTranslation();
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

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingPtz, setTestingPtz] = useState(false);
  const [ptzResult, setPtzResult] = useState<PtzResult | null>(null);
  const [isNewSite, setIsNewSite] = useState(false);
  const [siteOpen, setSiteOpen] = useState(false);

  // Smart Detection preview filter toggles
  const [sdShowPerson, setSdShowPerson] = useState(camera?.detectionModes?.includes("human") ?? true);
  const [sdShowPet, setSdShowPet] = useState(camera?.detectionModes?.includes("pet") ?? true);
  const [sdShowObject, setSdShowObject] = useState(camera?.detectionModes?.includes("object") ?? true);
  const [sdShowMotion, setSdShowMotion] = useState(camera?.detectionModes?.includes("pixel") ?? true);
  const [sdAiSensitivity, setSdAiSensitivity] = useState(camera?.aiSensitivity ?? 50);
  const [sdMotionSensitivity, setSdMotionSensitivity] = useState(camera?.motionSensitivity ?? 50);

  useEffect(() => {
    if (camera) {
      setForm({
        name: camera.name,
        brand: camera.brand || "Universal",
        ip: camera.ip,
        port: camera.port ?? DEFAULT_PORTS[camera.sourceType] ?? 80,
        sourceType: camera.sourceType ?? "ONVIF",
        streamPath: camera.streamPath ?? "",
        customUrl: camera.customUrl ?? "",
        username: camera.username || "",
        password: camera.password || "",
        site: camera.site || "",
        streamType: camera.streamType,
        audioMode: camera.audioMode ?? "Auto",
        enablePTZ: camera.enablePTZ,
        enabled: camera.enabled ?? true,
        enableRecording: camera.enableRecording ?? false,
        enableNotifications: camera.enableNotifications ?? false,
        enableSmartDetection: camera.enableSmartDetection,
        motionSensitivity: camera.motionSensitivity ?? 50,
        motionArea: camera.motionArea || null,
        excludeAreas: Array.isArray(camera.excludeAreas) ? camera.excludeAreas : [],
        detectionModes: Array.isArray(camera.detectionModes) ? camera.detectionModes : ["pixel", "human", "pet"],
        detectResolution: camera.detectResolution ?? "480p",
        enableSoundDetection: camera.enableSoundDetection ?? false,
        recordingMode: camera.recordingMode ?? "continuous",
        recordMode: camera.recordMode ?? "",
        recordResolution: camera.recordResolution ?? "Auto",
        aiSensitivity: camera.aiSensitivity ?? 50,
        detectFps: camera.detectFps ?? 6,
      });
      setSdAiSensitivity(camera.aiSensitivity ?? 50);
      setSdShowPerson(Array.isArray(camera.detectionModes) ? camera.detectionModes.includes("human") : true);
      setSdShowPet(Array.isArray(camera.detectionModes) ? camera.detectionModes.includes("pet") : false);
      setSdShowObject(Array.isArray(camera.detectionModes) ? camera.detectionModes.includes("object") : false);
      setSdShowMotion(Array.isArray(camera.detectionModes) ? camera.detectionModes.includes("pixel") : false);
    } else {
      setForm(emptyWithSite);
    }
    setErrors({});
    setShowPassword(false);
    setPtzResult(null);
    setIsNewSite(false);
  }, [camera, open]);

  const ptzSupported = SOURCE_SUPPORTS_PTZ[form.sourceType];
  const needsAuth = form.sourceType !== "Custom";
  const needsStreamPath = form.sourceType === "RTSP";
  const needsCustomUrl = form.sourceType === "Custom";
  const needsPort = form.sourceType !== "Custom" && form.sourceType !== "HomeAssistant";

  const handleSourceChange = (v: SourceType) => {
    setForm((f) => ({
      ...f,
      sourceType: v,
      port: DEFAULT_PORTS[v] || f.port,
      enablePTZ: SOURCE_SUPPORTS_PTZ[v] ? f.enablePTZ : false,
      streamPath: v === "RTSP" ? (f.streamPath || defaultPath("RTSP")) : "",
      customUrl: v === "Custom" ? f.customUrl : "",
    }));
  };

  // Build stream URL preview
  const streamUrlPreview = useMemo(
    () => buildStreamUrl(form, { maskPassword: !showPassword }),
    [form, showPassword]
  );
  const restreamUrl = useMemo(
    () => buildRestreamUrl({ id: camera?.id ?? "preview", streamType: form.streamType }),
    [camera?.id, form.streamType]
  );

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = t("nameRequired");
    if (!form.site.trim()) e.site = t("siteRequired");
    if (needsCustomUrl) {
      if (!form.customUrl.trim()) e.customUrl = "URL wajib diisi";
    } else {
      if (!form.ip.trim()) e.ip = t("ipRequired");
      if (needsPort && (!form.port || form.port < 1)) e.port = "Port tidak valid";
    }
    if (needsStreamPath && !form.streamPath.trim()) e.streamPath = "Stream path wajib diisi";
    if (Object.keys(e).length) { setErrors(e); return; }

    const payload: CameraInput = {
      name: form.name,
      brand: form.brand,
      ip: form.ip,
      port: form.port,
      sourceType: form.sourceType,
      streamPath: form.streamPath || undefined,
      customUrl: form.customUrl || undefined,
      username: form.username,
      site: form.site,
      streamType: form.streamType,
      audioMode: form.audioMode,
      enablePTZ: form.enablePTZ,
      enabled: form.enabled,
      enableRecording: form.enableRecording,
      enableNotifications: form.enableNotifications,
      motionSensitivity: form.motionSensitivity,
      motionArea: form.motionArea,
      excludeAreas: form.excludeAreas,
      detectionModes: form.detectionModes,
      detectResolution: form.detectResolution,
      detectFps: form.detectFps,
      aiSensitivity: form.aiSensitivity,
      enableSmartDetection: form.enableSmartDetection ?? (form.enableRecording || form.enableNotifications),
      enableSoundDetection: form.enableSoundDetection,
      recordingMode: form.recordingMode ?? "continuous",
      recordMode: form.recordMode,
      recordResolution: form.recordResolution,
      ...(form.password ? { password: form.password } : {}),
    };

    setSaving(true);
    try {
      if (camera) {
        await updateCamera(camera.id, payload);
        toast.success(t("cameraUpdated"));
      } else {
        await addCamera(payload);
        toast.success(t("cameraAdded"));
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("saveCameraFailed"));
    } finally {
      setSaving(false);
    }
  };

  const [syncingTime, setSyncingTime] = useState(false);
  const handleSyncTime = async () => {
    if (!camera) return;
    setSyncingTime(true);
    try {
      const res = await cameraApi.syncTime(camera.id);
      if (res.success) {
        toast.success(res.message || "Jam kamera berhasil disinkronkan");
      } else {
        toast.error(res.error || "Gagal menyinkronkan jam kamera");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menyinkronkan jam kamera");
    } finally {
      setSyncingTime(false);
    }
  };

  const testPtz = async () => {
    if (!camera) return;
    setTestingPtz(true);
    setPtzResult(null);
    try {
      const result = await cameraApi.testPtz(camera.id);
      setPtzResult(result);
      toast.success(t("onvifConnected", { mode: result.mode || "standard" }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("ptzTestFailed"));
    } finally {
      setTestingPtz(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[min(90vh,850px)] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="shrink-0 border-b px-6 py-5 pr-12">
          <DialogTitle>{camera ? t("editCamera") : t("addCamera")}</DialogTitle>
          <DialogDescription>{t("cameraFormDesc")}</DialogDescription>
        </DialogHeader>

        <div data-testid="camera-form-scroll" className="min-h-0 flex-1 px-6 py-5 flex flex-col">
          <Tabs defaultValue="general" className="w-full h-full flex flex-col">
            <TabsList className="grid w-full grid-cols-4 shrink-0 mb-4 h-10">
              <TabsTrigger value="general" className="text-xs">General</TabsTrigger>
              <TabsTrigger value="stream" className="text-xs">Stream</TabsTrigger>
              <TabsTrigger value="smart" className="text-xs">Smart Detection</TabsTrigger>
              <TabsTrigger value="alerts" className="text-xs">Alerts & Storage</TabsTrigger>
            </TabsList>

            {/* ─── TAB: GENERAL ─── */}
            <TabsContent value="general" className="flex-1 overflow-y-auto px-1 space-y-4 data-[state=active]:block data-[state=inactive]:hidden">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <Field label={t("cameraName")} error={errors.name}>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Lobby 01" />
                </Field>
                <Field label={t("brand")}>
                  <Select value={form.brand} onValueChange={(v) => setForm({ ...form, brand: v as Brand })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["Universal", "Bardi", "EZVIZ", "Hikvision"].map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>

                {/* Source Type */}
                <Field label="Stream Source" className="md:col-span-2">
                  <Select value={form.sourceType} onValueChange={(v) => handleSourceChange(v as SourceType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(SOURCE_LABELS) as SourceType[]).map((st) => (
                        <SelectItem key={st} value={st}>{SOURCE_LABELS[st]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1.5 flex items-start gap-1.5">
                    <Info className="h-3 w-3 mt-0.5 shrink-0" />
                    <span>{SOURCE_HELP[form.sourceType]}</span>
                  </p>
                </Field>

                {/* IP & Port — hidden for Custom */}
                {!needsCustomUrl && (
                  <>
                    <Field label={t("ipHost")} error={errors.ip}>
                      <Input value={form.ip} onChange={(e) => setForm({ ...form, ip: e.target.value })} placeholder="192.168.1.10" />
                    </Field>
                    {needsPort && (
                      <Field label="Port" error={errors.port}>
                        <Input type="number" min={1} max={65535} value={form.port}
                          onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
                          placeholder={String(DEFAULT_PORTS[form.sourceType])} />
                      </Field>
                    )}
                  </>
                )}

                {/* Stream Path — only RTSP */}
                {needsStreamPath && (
                  <Field label="Stream Path" className="md:col-span-2" error={errors.streamPath}>
                    <Input
                      value={form.streamPath}
                      onChange={(e) => setForm({ ...form, streamPath: e.target.value })}
                      placeholder="/Streaming/Channels/101"
                      className="font-mono text-xs"
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">Contoh: /Streaming/Channels/101, /stream1, /h264Preview_01_main</p>
                  </Field>
                )}

                {/* Custom URL — only Custom */}
                {needsCustomUrl && (
                  <Field label="Stream URL" className="md:col-span-2" error={errors.customUrl}>
                    <Input
                      value={form.customUrl}
                      onChange={(e) => setForm({ ...form, customUrl: e.target.value })}
                      placeholder="rtsp://admin:pass@192.168.1.10:554/stream1"
                      className="font-mono text-xs"
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Format go2rtc: rtsp://, onvif://, dvrip://, ffmpeg://, http://, exec:, dll.
                    </p>
                  </Field>
                )}

                {/* Username & Password — hidden for Custom */}
                {needsAuth && (
                  <>
                    <Field label={t("username")}>
                      <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="off" />
                    </Field>
                    <Field label={t("password")}>
                      <div className="relative">
                        <Input
                          type={showPassword ? "text" : "password"}
                          value={form.password}
                          onChange={(e) => setForm({ ...form, password: e.target.value })}
                          autoComplete="new-password"
                          className="pr-9"
                        />
                        <Button
                          type="button" size="icon" variant="ghost"
                          className="absolute right-0 top-0 h-full w-9 hover:bg-transparent text-muted-foreground hover:text-foreground"
                          onClick={() => setShowPassword((v) => !v)}
                          aria-label={showPassword ? t("hidePasswordLabel") : t("showPasswordLabel")}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                      {camera?.hasPassword && !form.password && (
                        <p className="text-[11px] text-muted-foreground mt-1">{t("passwordHelp")}</p>
                      )}
                    </Field>
                  </>
                )}

                {/* Site / Group */}
                <Field label={t("siteGroup")} error={errors.site} className="md:col-span-2">
                  {user?.role !== "admin" && Array.isArray(user?.allowedGroups) && user.allowedGroups.length > 0 ? (
                    <Popover open={siteOpen} onOpenChange={setSiteOpen}>
                      <PopoverTrigger asChild>
                        <Button variant="outline" role="combobox" aria-expanded={siteOpen} className="w-full justify-between font-normal">
                          {form.site || t("selectSite")}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-full p-0">
                        <Command>
                          <CommandInput placeholder={t("searchSite")} />
                          <CommandList>
                            <CommandEmpty>{t("noSiteFound")}</CommandEmpty>
                            <CommandGroup>
                              {user.allowedGroups.map((g) => (
                                <CommandItem key={g} value={g} onSelect={(v) => { setForm({ ...form, site: v }); setSiteOpen(false); }}>
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
                              {form.site || t("selectSite")}
                              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-full p-0">
                            <Command>
                              <CommandInput placeholder={t("searchSite")} />
                              <CommandList>
                                <CommandEmpty>{t("noSiteFound")}</CommandEmpty>
                                <CommandGroup>
                                  {siteOptions.map((s) => (
                                    <CommandItem key={s} value={s} onSelect={(v) => { setForm({ ...form, site: v }); setSiteOpen(false); }}>
                                      <Check className={cn("mr-2 h-4 w-4", form.site === s ? "opacity-100" : "opacity-0")} />
                                      {s}
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                                <CommandGroup>
                                  <CommandItem
                                    value="___new___"
                                    className="text-primary font-medium"
                                    onSelect={() => { setIsNewSite(true); setForm({ ...form, site: "" }); setSiteOpen(false); }}
                                  >
                                    {t("addNewSite")}
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
                            placeholder={t("typeNewSite")}
                            className="flex-1"
                            autoFocus
                          />
                          <Button variant="outline" size="sm" type="button" onClick={() => setIsNewSite(false)}>{t("cancel")}</Button>
                        </div>
                      )}
                    </div>
                  )}
                </Field>
              </div>
            </TabsContent>

            {/* ─── TAB: STREAM ─── */}
            <TabsContent value="stream" className="flex-1 overflow-y-auto px-1 space-y-4 data-[state=active]:block data-[state=inactive]:hidden">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

                {/* Output Format Dropdown */}
                <div className="md:col-span-2 space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Output Format</Label>
                  <Select value={form.streamType} onValueChange={(v) => setForm({ ...form, streamType: v as StreamType })}>
                    <SelectTrigger className="w-full h-auto py-2 px-3 text-left">
                      <div className="flex-1 truncate">
                        {(() => {
                          const val = form.streamType;
                          if (val === "webrtc,mse,hls,mjpeg") return <div className="font-medium">Auto-select mode</div>;
                          if (val === "webrtc") return <div className="font-medium">WebRTC stream</div>;
                          if (val === "mse") return <div className="font-medium">MSE stream</div>;
                          if (val === "mp4") return <div className="font-medium">legacy MP4 stream</div>;
                          if (val === "mp4_modern") return <div className="font-medium">modern MP4 stream</div>;
                          if (val === "mp4_all") return <div className="font-medium">MP4 stream with any audio</div>;
                          if (val === "frame_mp4") return <div className="font-medium">snapshot in MP4-format</div>;
                          if (val === "hls") return <div className="font-medium">legacy HLS/TS</div>;
                          if (val === "hls_fmp4") return <div className="font-medium">legacy HLS/fMP4</div>;
                          if (val === "hls_modern") return <div className="font-medium">modern HLS/fMP4</div>;
                          if (val === "mjpeg") return <div className="font-medium">MJPEG stream</div>;
                          return <div className="font-medium">{val}</div>;
                        })()}
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="webrtc,mse,hls,mjpeg" className="py-2">
                        <div className="font-medium">Auto-select mode</div>
                        <div className="text-[10px] text-muted-foreground">browsers: all / codecs: H264, H265*, MJPEG, JPEG, AAC, PCMU, PCMA, OPUS</div>
                      </SelectItem>
                      <SelectItem value="webrtc" className="py-2">
                        <div className="font-medium">WebRTC stream</div>
                        <div className="text-[10px] text-muted-foreground">browsers: all / codecs: H264, PCMU, PCMA, OPUS / +H265 in Safari</div>
                      </SelectItem>
                      <SelectItem value="mse" className="py-2">
                        <div className="font-medium">MSE stream</div>
                        <div className="text-[10px] text-muted-foreground">browsers: Chrome, Firefox, Safari Mac/iPad / codecs: H264, H265*, AAC, PCMA*, PCMU*, PCM*</div>
                      </SelectItem>
                      <SelectItem value="mp4" className="py-2">
                        <div className="font-medium">legacy MP4 stream (AAC audio)</div>
                        <div className="text-[10px] text-muted-foreground">browsers: Chrome, Firefox / codecs: H264, H265*, AAC</div>
                      </SelectItem>
                      <SelectItem value="mp4_modern" className="py-2">
                        <div className="font-medium">modern MP4 stream (common audio)</div>
                        <div className="text-[10px] text-muted-foreground">browsers: Chrome, Firefox / codecs: H264, H265*, AAC, FLAC (PCMA, PCMU, PCM)</div>
                      </SelectItem>
                      <SelectItem value="mp4_all" className="py-2">
                        <div className="font-medium">MP4 stream with any audio</div>
                        <div className="text-[10px] text-muted-foreground">browsers: Chrome / codecs: H264, H265*, AAC, OPUS, MP3, FLAC (PCMA, PCMU, PCM)</div>
                      </SelectItem>
                      <SelectItem value="frame_mp4" className="py-2">
                        <div className="font-medium">snapshot in MP4-format</div>
                        <div className="text-[10px] text-muted-foreground">browsers: all / codecs: H264, H265*</div>
                      </SelectItem>
                      <SelectItem value="hls" className="py-2">
                        <div className="font-medium">legacy HLS/TS</div>
                        <div className="text-[10px] text-muted-foreground">browsers: Safari all, Chrome Android / codecs: H264</div>
                      </SelectItem>
                      <SelectItem value="hls_fmp4" className="py-2">
                        <div className="font-medium">legacy HLS/fMP4</div>
                        <div className="text-[10px] text-muted-foreground">browsers: Safari all, Chrome Android / codecs: H264, H265*, AAC</div>
                      </SelectItem>
                      <SelectItem value="hls_modern" className="py-2">
                        <div className="font-medium">modern HLS/fMP4</div>
                        <div className="text-[10px] text-muted-foreground">browsers: Safari all, Chrome Android / codecs: H264, H265*, AAC, FLAC (PCMA, PCMU, PCM)</div>
                      </SelectItem>
                      <SelectItem value="mjpeg" className="py-2">
                        <div className="font-medium">MJPEG stream</div>
                        <div className="text-[10px] text-muted-foreground">browsers: all / codecs: MJPEG, JPEG</div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Camera Active */}
                <div className="md:col-span-2 flex items-center justify-between rounded-md border p-3">
                  <div className="min-w-0 pr-2">
                    <Label className="text-sm">{t("cameraActiveLabel")}</Label>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{t("cameraActiveHelp")}</p>
                  </div>
                  <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
                </div>

                {/* Audio Mode */}
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Audio</Label>
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

                {/* PTZ */}
                <div className={cn("flex items-center justify-between rounded-md border p-3", !ptzSupported && "opacity-60")}>
                  <div className="min-w-0 pr-2">
                    <Label className="text-sm">{t("enablePtzLabel")}</Label>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {ptzSupported ? t("ptzSupportedHelp") : t("ptzUnsupportedHelp")}
                    </p>
                  </div>
                  <Switch checked={form.enablePTZ} disabled={!ptzSupported}
                    onCheckedChange={(v) => setForm({ ...form, enablePTZ: v })} />
                </div>
              </div>
            </TabsContent>

            {/* ─── TAB: ALERTS & STORAGE ─── */}
            <TabsContent value="alerts" className="flex-1 overflow-y-auto px-1 space-y-4 data-[state=active]:block data-[state=inactive]:hidden">
              <div className="space-y-4 max-w-3xl">
                {/* Recording Configuration Card */}
                <div className="rounded-md border p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 pr-2">
                      <Label className="text-sm font-semibold">{t("enableRecording")}</Label>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{t("enableRecordingHelp")}</p>
                    </div>
                    <Switch checked={form.enableRecording}
                      onCheckedChange={(v) => setForm({ ...form, enableRecording: v })} />
                  </div>

                  {form.enableRecording && (
                    <div className="pt-3 border-t space-y-4 animate-fade-in">
                      <div className="space-y-2">
                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">{t("recordingModeLabel")}</Label>
                        <Select
                          value={form.recordingMode || "continuous"}
                          onValueChange={(v) => setForm({ ...form, recordingMode: v })}
                        >
                          <SelectTrigger className="w-full h-9 text-xs">
                            <SelectValue placeholder={t("selectRecordingMode")} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="continuous">{t("continuousMode")}</SelectItem>
                            <SelectItem value="event">{t("eventMode")}</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-[10px] text-muted-foreground">
                          {form.recordingMode === "event" ? t("eventModeHelp") : t("continuousModeHelp")}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Notifications */}
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div className="min-w-0 pr-2">
                    <Label className="text-sm font-semibold">{t("enableNotifications")}</Label>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{t("enableNotificationsHelp")}</p>
                  </div>
                  <Switch checked={form.enableNotifications}
                    onCheckedChange={(v) => setForm({ ...form, enableNotifications: v })} />
                </div>
              </div>
            </TabsContent>

            {/* ─── TAB: SMART DETECTION ─── */}
            <TabsContent value="smart" className="flex-1 overflow-y-auto px-1 space-y-4 data-[state=active]:block data-[state=inactive]:hidden">
              <div className="space-y-4">
                <div className="flex items-center justify-between rounded-md border p-3 bg-muted/20">
                  <div className="min-w-0 pr-2">
                    <Label className="text-sm font-semibold">Enable Smart Detection & AI</Label>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Turn on/off motion & AI processing for this camera. Required for events/notifications.
                    </p>
                  </div>
                  <Switch
                    checked={form.enableSmartDetection ?? (form.enableRecording || form.enableNotifications)}
                    onCheckedChange={(v) => setForm({ ...form, enableSmartDetection: v })}
                  />
                </div>

                {(form.enableSmartDetection ?? (form.enableRecording || form.enableNotifications)) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 animate-fade-in">
                    <div className="flex items-center justify-between rounded-md border p-3">
                      <div className="min-w-0 pr-2 flex-1">
                        <Label className="text-sm font-semibold">{t("detectionResolution")}</Label>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {t("detectionResolutionHelp")}
                        </p>
                      </div>
                      <Select value={form.detectResolution || "480p"} onValueChange={(v) => setForm({ ...form, detectResolution: v as Camera["detectResolution"] })}>
                        <SelectTrigger className="w-[100px] h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Auto">Auto (Ikuti Stream)</SelectItem>
                          <SelectItem value="720p">720p</SelectItem>
                          <SelectItem value="480p">480p (Standard)</SelectItem>
                          <SelectItem value="360p">360p (Ringan)</SelectItem>
                          <SelectItem value="144p">144p (Minimal)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex items-center justify-between rounded-md border p-3">
                      <div className="min-w-0 pr-2 flex-1">
                        <Label className="text-sm font-semibold">Detection FPS</Label>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          Live View smoothness vs CPU load.
                        </p>
                      </div>
                      <Select value={String(form.detectFps || 6)} onValueChange={(v) => setForm({ ...form, detectFps: Number(v) })}>
                        <SelectTrigger className="w-[80px] h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">1 FPS</SelectItem>
                          <SelectItem value="2">2 FPS</SelectItem>
                          <SelectItem value="4">4 FPS</SelectItem>
                          <SelectItem value="6">6 FPS</SelectItem>
                          <SelectItem value="10">10 FPS</SelectItem>
                          <SelectItem value="15">15 FPS</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {/* Smart Detection Live View & Masking Area */}
                {(form.enableSmartDetection ?? (form.enableRecording || form.enableNotifications)) && (
                  <div className="rounded-md border p-4 space-y-3 animate-fade-in">
                  <div>
                    <Label className="text-sm font-semibold">{t("smartDetectionLiveView")}</Label>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {t("smartDetectionLiveViewHelp")}
                    </p>
                  </div>
                  <SmartDetectionEditor
                    cameraId={camera?.id || ""}
                    cameraEnabled={Boolean(camera?.enabled)}
                    value={form.excludeAreas || []}
                    onChange={(areas) => setForm({ ...form, excludeAreas: areas })}
                    showPixelMotion={sdShowMotion}
                    showPerson={sdShowPerson}
                    showPet={sdShowPet}
                    showObject={sdShowObject}
                    aiSensitivity={sdAiSensitivity}
                    motionSensitivityValue={sdMotionSensitivity}
                    onShowPersonChange={(val) => {
                      setSdShowPerson(val);
                      const modes = new Set(form.detectionModes || ["pixel", "human", "pet", "object"]);
                      if (val) modes.add("human"); else modes.delete("human");
                      setForm({ ...form, detectionModes: Array.from(modes) });
                    }}
                    onShowPetChange={(val) => {
                      setSdShowPet(val);
                      const modes = new Set(form.detectionModes || ["pixel", "human", "pet", "object"]);
                      if (val) modes.add("pet"); else modes.delete("pet");
                      setForm({ ...form, detectionModes: Array.from(modes) });
                    }}
                    onShowObjectChange={(val) => {
                      setSdShowObject(val);
                      const modes = new Set(form.detectionModes || ["pixel", "human", "pet", "object"]);
                      if (val) modes.add("object"); else modes.delete("object");
                      setForm({ ...form, detectionModes: Array.from(modes) });
                    }}
                    onShowPixelMotionChange={(val) => {
                      setSdShowMotion(val);
                      const modes = new Set(form.detectionModes || ["pixel", "human", "pet", "object"]);
                      if (val) modes.add("pixel"); else modes.delete("pixel");
                      setForm({ ...form, detectionModes: Array.from(modes) });
                    }}
                    onAiSensitivityChange={(val) => {
                      setSdAiSensitivity(val);
                      setForm({ ...form, aiSensitivity: val });
                    }}
                    onMotionSensitivityChange={(val) => {
                      setSdMotionSensitivity(val);
                      setForm({ ...form, motionSensitivity: val });
                    }}
                    enableSoundDetection={form.enableSoundDetection}
                    onEnableSoundDetectionChange={(val) => setForm({ ...form, enableSoundDetection: val })}
                  />
                </div>
                )}
              </div>
            </TabsContent>

          </Tabs>

          {/* ─── URL PREVIEW & PTZ TEST ─── */}
          <div className="mt-4 pt-4 border-t space-y-4 shrink-0">
            <div className="rounded-md border bg-muted/30 p-3 space-y-2.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{t("urlPreview")}</div>
              <UrlRow icon={<Link2 className="h-3.5 w-3.5" />} label="Source Stream URL" value={streamUrlPreview} tone="primary" />
              <UrlRow icon={<Radio className="h-3.5 w-3.5" />} label={`Restream URL`} value={restreamUrl} tone="success" />
            </div>

            {camera && form.sourceType === "ONVIF" && form.enablePTZ && (
              <div className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">{t("ptzDiagnostic")}</div>
                    <p className="text-[11px] text-muted-foreground">{t("ptzDiagnosticHelp")}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={handleSyncTime} disabled={syncingTime}>
                      <Clock className="h-3.5 w-3.5 mr-1" />
                      {syncingTime ? "Proses..." : "Sync Jam Kamera"}
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={testPtz} disabled={testingPtz}>
                      <TestTube2 className="h-3.5 w-3.5 mr-1" />
                      {testingPtz ? t("ptzSending") : "Test ONVIF/PTZ"}
                    </Button>
                  </div>
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
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
          <Button onClick={submit} disabled={saving}>{saving ? t("savingEllipsis") : camera ? t("save") : t("add")}</Button>
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
  const { t } = useTranslation();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("copied", { label }));
    } catch {
      toast.error(t("copyFailed"));
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
