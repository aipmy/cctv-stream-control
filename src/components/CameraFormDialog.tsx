import { useEffect, useMemo, useState, useRef } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import type { Camera, CameraInput, Brand, StreamType, SourceType, RtspTransport, HlsMode, MotionArea } from "@/types";
import { SOURCE_SUPPORTS_PTZ } from "@/types";
import { Info, Eye, EyeOff, Copy, Link2, Radio, TestTube2, Wand2, Activity, Check, ChevronsUpDown } from "lucide-react";
import { cameraApi, type PtzResult } from "@/lib/api";
import { useAuth } from "@/features/auth/store";
import { useCamerasQuery, useCameraActions } from "@/features/cameras/queries";
import { buildSourceUrl, buildOnvifUrl, buildRestreamUrl, DEFAULT_PORTS, defaultPath } from "@/lib/cctv";
import { CameraLiveView } from "./CameraLiveView";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useTranslation, type TranslationKey } from "@/hooks/useTranslation";

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
  enableRecording: false,
  enableNotifications: false,
  motionSensitivity: 50,
  motionArea: null as MotionArea | null,
  excludeAreas: [] as MotionArea[],
  detectionModes: [] as string[],
  detectResolution: "480p" as Camera["detectResolution"],
  recordingMode: "continuous",
  recordMode: "" as Camera["recordMode"],
  recordResolution: "Auto" as Camera["recordResolution"],
};

const sourceHelpKeys: Record<SourceType, TranslationKey> = {
  RTSP: "sourceHelpRTSP",
  "RTSP+ONVIF": "sourceHelpRTSPONVIF",
  MJPEG: "sourceHelpMJPEG",
  HLS: "sourceHelpHLS",
};

interface Preset {
  nameKey: TranslationKey;
  descKey: TranslationKey;
  streamType: StreamType;
  rtspTransport: RtspTransport;
  hlsMode: HlsMode;
  audioMode: "Auto" | "Enable" | "Disable";
}

const PRESETS: Preset[] = [
  {
    nameKey: "preset0Name",
    descKey: "preset0Desc",
    streamType: "HLS Low Latency",
    rtspTransport: "tcp",
    hlsMode: "copy",
    audioMode: "Disable",
  },
  {
    nameKey: "preset1Name",
    descKey: "preset1Desc",
    streamType: "HLS Stable",
    rtspTransport: "tcp",
    hlsMode: "transcode",
    audioMode: "Disable",
  },
  {
    nameKey: "preset2Name",
    descKey: "preset2Desc",
    streamType: "HLS Stable",
    rtspTransport: "tcp",
    hlsMode: "transcode",
    audioMode: "Enable",
  },
  {
    nameKey: "preset3Name",
    descKey: "preset3Desc",
    streamType: "MJPEG",
    rtspTransport: "tcp",
    hlsMode: "copy",
    audioMode: "Disable",
  },
];

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
      toast.error(t("ipRequiredForDetect"));
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
        let explanationKey: TranslationKey = "probeExplH264None";
        let explanationParams: Record<string, string> = {};
        
        if (videoCodec === "h264") {
          if (audioCodec === "aac") {
            recIndex = 2;
            explanationKey = "probeExplH264Aac";
          } else if (audioCodec === "none") {
            recIndex = 0;
            explanationKey = "probeExplH264None";
          } else {
            recIndex = 1;
            explanationKey = "probeExplH264Other";
            explanationParams = { codec: audioCodec };
          }
        } else if (videoCodec === "hevc" || videoCodec === "h265") {
          if (audioCodec === "none") {
            recIndex = 1;
            explanationKey = "probeExplH265None";
          } else {
            recIndex = 2;
            explanationKey = "probeExplH265Other";
            explanationParams = { codec: audioCodec };
          }
        } else {
          recIndex = 1;
          explanationKey = "probeExplUnknown";
          explanationParams = { codec: videoCodec };
        }
        
        setProbeDetectResult({
          success: true,
          message: t(explanationKey, explanationParams),
          videoCodec,
          audioCodec,
          recommendedIndex: recIndex,
        });
        toast.success(t("probeSuccess"));
      } else {
        const errMsg = res.probe?.error || t("probeFailedLabel");
        setProbeDetectResult({
          success: false,
          message: `${t("probeFailedLabel")} Error: ${errMsg}`,
        });
        toast.error(t("probeFailedLabel"));
      }
    } catch (err) {
      setProbeDetectResult({
        success: false,
        message: err instanceof Error ? err.message : t("probeRequestFailed"),
      });
      toast.error(t("probeRequestFailed"));
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
        toast.success(t("presetApplied", { name: t(p.nameKey) }));
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
        audioMode: camera.audioMode ?? "Auto",
        enablePTZ: camera.enablePTZ,
        enabled: camera.enabled ?? true,
        enableRecording: camera.enableRecording ?? false,
        enableNotifications: camera.enableNotifications ?? false,
        motionSensitivity: camera.motionSensitivity ?? 50,
        motionArea: camera.motionArea || null,
        excludeAreas: Array.isArray(camera.excludeAreas) ? camera.excludeAreas : [],
        detectionModes: Array.isArray(camera.detectionModes) ? camera.detectionModes : ["pixel", "human", "pet"],
        detectResolution: camera.detectResolution ?? "480p",
        recordingMode: camera.recordingMode ?? "continuous",
        recordMode: camera.recordMode ?? "",
        recordResolution: camera.recordResolution ?? "Auto",
      });
    } else {
      setForm(emptyWithSite);
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
    if (!form.name.trim()) e.name = t("nameRequired");
    if (!form.ip.trim()) e.ip = t("ipRequired");
    if (!form.site.trim()) e.site = t("siteRequired");
    if (!form.sourcePath.trim()) e.sourcePath = t("pathRequired");
    if (isRtspFamily && (!form.rtspPort || form.rtspPort < 1)) e.rtspPort = t("invalidRtspPort");
    if (form.sourceType === "RTSP+ONVIF" && (!form.onvifPort || form.onvifPort < 1)) e.onvifPort = t("invalidOnvifPort");
    if (!isRtspFamily && (!form.httpPort || form.httpPort < 1)) e.httpPort = t("invalidHttpPort");
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
      enableRecording: form.enableRecording,
      enableNotifications: form.enableNotifications,
      motionSensitivity: form.motionSensitivity,
      motionArea: form.motionArea,
      excludeAreas: form.excludeAreas,
      detectionModes: form.detectionModes,
      detectResolution: form.detectResolution,
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

        <div data-testid="camera-form-scroll" className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
          <Field label={t("ipHost")} error={errors.ip}>
            <Input value={form.ip} onChange={(e) => setForm({ ...form, ip: e.target.value })} placeholder="192.168.1.10" />
          </Field>
          <Field label={t("siteGroup")} error={errors.site}>
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

          <Field label={t("streamSource")} className="md:col-span-2">
            <Select value={form.sourceType} onValueChange={(v) => handleSourceChange(v as SourceType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="RTSP">{t("rtspVideoOnly")}</SelectItem>
                <SelectItem value="RTSP+ONVIF">{t("rtspOnvifPtz")}</SelectItem>
                <SelectItem value="MJPEG">{t("mjpegLegacy")}</SelectItem>
                <SelectItem value="HLS">{t("hlsTranscoded")}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1.5 flex items-start gap-1.5">
              <Info className="h-3 w-3 mt-0.5 shrink-0" />
              <span>{t(sourceHelpKeys[form.sourceType])}</span>
            </p>
          </Field>

          {isRtspFamily ? (
            <>
              <Field label={t("rtspPortLabel")} error={errors.rtspPort}>
                <Input type="number" min={1} max={65535} value={form.rtspPort}
                  onChange={(e) => setForm({ ...form, rtspPort: Number(e.target.value) })} placeholder="554" />
              </Field>
              {form.sourceType === "RTSP+ONVIF" ? (
                <Field label={t("onvifPortLabel")} error={errors.onvifPort}>
                  <Input type="number" min={1} max={65535} value={form.onvifPort}
                    onChange={(e) => setForm({ ...form, onvifPort: Number(e.target.value) })} placeholder="80" />
                </Field>
              ) : (
                <div />
              )}
            </>
          ) : (
            <Field label={form.sourceType === "HLS" ? t("httpsPortLabel") : t("httpPortLabel")} error={errors.httpPort}>
              <Input type="number" min={1} max={65535} value={form.httpPort}
                onChange={(e) => setForm({ ...form, httpPort: Number(e.target.value) })}
                placeholder={form.sourceType === "HLS" ? "443" : "80"} />
            </Field>
          )}

          <Field label={t("streamPath")} className="md:col-span-2" error={errors.sourcePath}>
            <Input
              value={form.sourcePath}
              onChange={(e) => setForm({ ...form, sourcePath: e.target.value })}
              placeholder={defaultPath(form.sourceType)}
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              {t("streamPathHelp")}
            </p>
          </Field>

          <Field label={t("username")}>
            <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="off" />
          </Field>
          <Field label={t("password")}>
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
                aria-label={showPassword ? t("hidePasswordLabel") : t("showPasswordLabel")}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            {camera?.hasPassword && !form.password && (
              <p className="text-[11px] text-muted-foreground mt-1">{t("passwordHelp")}</p>
            )}
          </Field>

          <div className="md:col-span-2 border-t pt-4 mt-2">
            <h3 className="text-sm font-semibold tracking-tight">{t("streamSettingsHeader")}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{t("streamSettingsSub")}</p>
          </div>

          <Field label={t("streamPresetLabel")} className="md:col-span-2">
            <div className="flex gap-2">
              <div className="flex-1">
                <Select value={activePresetValue} onValueChange={handlePresetChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRESETS.map((p, idx) => (
                      <SelectItem key={idx} value={String(idx)}>
                        {t(p.nameKey)}
                      </SelectItem>
                    ))}
                    <SelectItem value="custom">{t("customPreset")}</SelectItem>
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
                {probing ? t("detecting") : t("detectCodec")}
              </Button>
            </div>
            {activePresetIndex !== -1 && (
              <p className="text-[11px] text-muted-foreground mt-1.5">
                {t(PRESETS[activePresetIndex].descKey)}
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
                  {t("probeResultsHeader")}
                </div>
                {probeDetectResult.success && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={applyRecommendation}
                    className="h-7 text-[11px] bg-gradient-primary hover:opacity-90 text-primary-foreground font-medium"
                  >
                    {t("applyRecommendation")}
                  </Button>
                )}
              </div>
              {probeDetectResult.success ? (
                <div className="space-y-1 mt-1">
                  <div className="grid grid-cols-2 gap-2 font-mono text-[11px] bg-muted/30 p-2 rounded">
                    <div>{t("videoCodec")} <span className="font-bold text-primary">{probeDetectResult.videoCodec}</span></div>
                    <div>{t("audioCodec")} <span className="font-bold text-primary">{probeDetectResult.audioCodec}</span></div>
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
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("outputFormat")}</Label>
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
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("streamQuality")}</Label>
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
            <Field label={t("rtspTransportLabel")}>
              <Select value={form.rtspTransport} onValueChange={(v) => setForm({ ...form, rtspTransport: v as RtspTransport })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="tcp">TCP — paling stabil</SelectItem>
                  <SelectItem value="udp">UDP — latency rendah</SelectItem>
                  <SelectItem value="auto">Auto — default FFmpeg</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">{t("rtspTransportHelp")}</p>
            </Field>
          )}

          {form.streamType !== "MJPEG" && isRtspFamily && (
            <Field label={t("hlsModeLabel")}>
              <Select value={form.hlsMode} onValueChange={(v) => setForm({ ...form, hlsMode: v as HlsMode })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="copy">Copy — ringan, sesuai command manual</SelectItem>
                  <SelectItem value="transcode">Transcode — kompatibel, CPU lebih berat</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">{t("hlsModeHelp")}</p>
            </Field>
          )}

          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="min-w-0 pr-2">
              <Label className="text-sm">{t("cameraActiveLabel")}</Label>
              <p className="text-[11px] text-muted-foreground mt-0.5">{t("cameraActiveHelp")}</p>
            </div>
            <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-sm">{t("audioSettings")}</Label>
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
              <Label className="text-sm">{t("enablePtzLabel")}</Label>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {ptzSupported ? t("ptzSupportedHelp") : t("ptzUnsupportedHelp")}
              </p>
            </div>
            <Switch checked={form.enablePTZ} disabled={!ptzSupported}
              onCheckedChange={(v) => setForm({ ...form, enablePTZ: v })} />
          </div>

          {/* Recording Configuration Card */}
          <div className="md:col-span-2 rounded-md border p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="min-w-0 pr-2">
                <Label className="text-sm font-semibold">{t("enableRecording")}</Label>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {t("enableRecordingHelp")}
                </p>
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
                    {form.recordingMode === "event"
                      ? t("eventModeHelp")
                      : t("continuousModeHelp")}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">Recording Quality (Beta) <span className="px-1 py-0.5 rounded bg-blue-500/20 text-blue-400 text-[9px]">BETA</span></Label>
                  <Select
                    value={form.recordMode || ""}
                    onValueChange={(v) => setForm({ ...form, recordMode: v as any })}
                  >
                    <SelectTrigger className="w-full h-9 text-xs">
                      <SelectValue placeholder="Ikuti Live Stream" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Ikuti Live Stream</SelectItem>
                      <SelectItem value="copy">Copy Asli (Paling Ringan)</SelectItem>
                      <SelectItem value="transcode">Custom Transcode</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">
                    {form.recordMode === "transcode" ? <span className="text-amber-500 flex items-center gap-1"><Info className="w-3 h-3" /> Transcode memakan CPU berat.</span> : "Memisahkan kualitas rekaman dengan Live Stream."}
                  </p>
                </div>
                {form.recordMode === "transcode" && (
                  <div className="space-y-2 pl-4 border-l-2 border-muted animate-fade-in">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Custom Resolution</Label>
                    <Select
                      value={form.recordResolution || "Auto"}
                      onValueChange={(v) => setForm({ ...form, recordResolution: v as any })}
                    >
                      <SelectTrigger className="w-full h-9 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Auto">Auto / Sama dengan sumber</SelectItem>
                        <SelectItem value="1080p">1080p (FHD)</SelectItem>
                        <SelectItem value="720p">720p (HD)</SelectItem>
                        <SelectItem value="480p">480p (SD)</SelectItem>
                        <SelectItem value="360p">360p (Hemat)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Notifications Switch */}
          <div className="flex items-center justify-between rounded-md border p-3 md:col-span-2">
            <div className="min-w-0 pr-2">
              <Label className="text-sm font-semibold">{t("enableNotifications")}</Label>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {t("enableNotificationsHelp")}
              </p>
            </div>
            <Switch checked={form.enableNotifications}
              onCheckedChange={(v) => setForm({ ...form, enableNotifications: v })} />
          </div>

          {/* Motion detection settings - displayed if notifications are enabled OR event-based recording is enabled */}
          {(form.enableNotifications || form.enableRecording) && (
            <>
              {/* ──── Sensitivity Slider (1-100%) ──── */}
              <div className="md:col-span-2 rounded-md border p-4 space-y-3 animate-fade-in">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 pr-2 flex-1">
                    <Label className="text-sm font-semibold">{t("motionSensitivity")}</Label>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {t("motionSensitivityDesc")}
                    </p>
                  </div>
                  <div className="text-right shrink-0 ml-2 tabular-nums">
                    <span className="text-lg font-bold text-primary">{form.motionSensitivity ?? 50}%</span>
                  </div>
                </div>
                <input
                  type="range"
                  min={1}
                  max={100}
                  step={1}
                  value={form.motionSensitivity ?? 50}
                  onChange={(e) => setForm({ ...form, motionSensitivity: Number(e.target.value) })}
                  className="w-full h-2 bg-muted rounded-full appearance-none cursor-pointer accent-primary"
                />
                <div className="flex justify-between text-[9px] text-muted-foreground font-mono">
                  <span>{t("sensLargeOnly")}</span>
                  <span>{t("sensStandard")}</span>
                  <span>{t("sensVerySensitive")}</span>
                </div>
              </div>

              {/* ──── Detection Resolution ──── */}
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
                      <SelectItem value="Auto">{t("all")}</SelectItem>
                      <SelectItem value="720p">720p</SelectItem>
                      <SelectItem value="480p">{t("detectResStandard")}</SelectItem>
                      <SelectItem value="360p">{t("detectResLight")}</SelectItem>
                      <SelectItem value="144p">{t("detectResMinimal")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* ──── Detection FPS ──── */}
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

              {/* ──── Smart Detection Modes ──── */}
              <div className="md:col-span-2 rounded-md border p-4 space-y-3 animate-fade-in">
                <div>
                  <Label className="text-sm font-semibold">{t("smartDetectionType")}</Label>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{t("smartDetectionTypeHelp")}</p>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="mode-pixel"
                      checked={form.detectionModes?.includes("pixel")}
                      onCheckedChange={(checked) => {
                        const current = form.detectionModes || [];
                        const next = checked
                          ? [...current, "pixel"]
                          : current.filter((m) => m !== "pixel");
                        setForm({ ...form, detectionModes: next });
                      }}
                    />
                    <label htmlFor="mode-pixel" className="text-xs font-medium leading-none cursor-pointer">
                      {t("pixelBadge")}
                    </label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="mode-human"
                      checked={form.detectionModes?.includes("human")}
                      onCheckedChange={(checked) => {
                        const current = form.detectionModes || [];
                        const next = checked
                          ? [...current, "human"]
                          : current.filter((m) => m !== "human");
                        setForm({ ...form, detectionModes: next });
                      }}
                    />
                    <label htmlFor="mode-human" className="text-xs font-medium leading-none cursor-pointer">
                      {t("humanBadge")}
                    </label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="mode-pet"
                      checked={form.detectionModes?.includes("pet")}
                      onCheckedChange={(checked) => {
                        const current = form.detectionModes || [];
                        const next = checked
                          ? [...current, "pet"]
                          : current.filter((m) => m !== "pet");
                        setForm({ ...form, detectionModes: next });
                      }}
                    />
                    <label htmlFor="mode-pet" className="text-xs font-medium leading-none cursor-pointer">
                      {t("petBadge")}
                    </label>
                  </div>
                </div>
              </div>

              {/* ──── Smart Detection Live View & Masking Area ──── */}
              <div className="md:col-span-2 rounded-md border p-4 space-y-3 animate-fade-in">
                <div>
                  <Label className="text-sm font-semibold">{t("smartDetectionLiveView")}</Label>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {t("smartDetectionLiveViewHelp")}
                  </p>
                </div>
                <UnifiedMotionEditor
                  cameraId={camera?.id || ""}
                  cameraEnabled={Boolean(camera?.enabled)}
                  value={form.excludeAreas || []}
                  onChange={(areas) => setForm({ ...form, excludeAreas: areas })}
                />
              </div>
            </>
          )}

          <div className="md:col-span-2 rounded-md border bg-muted/30 p-3 space-y-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{t("urlPreview")}</div>
            <UrlRow icon={<Link2 className="h-3.5 w-3.5" />} label={t("originalSource")} value={sourceUrlPreview} tone="primary" />
            {form.sourceType === "RTSP+ONVIF" && (
              <UrlRow icon={<Link2 className="h-3.5 w-3.5" />} label="ONVIF Endpoint" value={onvifUrlPreview} />
            )}
            <UrlRow icon={<Radio className="h-3.5 w-3.5" />} label={`Restream (${form.streamType})`} value={restreamUrl} tone="success" />
          </div>

          {camera && form.sourceType === "RTSP+ONVIF" && form.enablePTZ && (
            <div className="md:col-span-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">{t("ptzDiagnostic")}</div>
                  <p className="text-[11px] text-muted-foreground">{t("ptzDiagnosticHelp")}</p>
                </div>
                <Button type="button" variant="outline" onClick={testPtz} disabled={testingPtz}>
                  <TestTube2 className="h-4 w-4" />
                  {testingPtz ? t("ptzSending") : "Test ONVIF/PTZ"}
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
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
          <Button onClick={submit} disabled={saving}>{saving ? t("savingEllipsis") : camera ? t("save") : t("add")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RoiSelector({
  value,
  onChange,
  camera,
}: {
  value: MotionArea | null;
  onChange: (area: MotionArea | null) => void;
  camera?: Camera | null;
}) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [currentPos, setCurrentPos] = useState({ x: 0, y: 0 });

  const activeArea = value || { x: 0, y: 0, w: 1, h: 1 };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setStartPos({ x, y });
    setCurrentPos({ x, y });
    setIsDrawing(true);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDrawing || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setCurrentPos({ x, y });
  };

  const handleMouseUp = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const x = Math.min(startPos.x, currentPos.x);
    const y = Math.min(startPos.y, currentPos.y);
    const w = Math.max(0.05, Math.abs(startPos.x - currentPos.x));
    const h = Math.max(0.05, Math.abs(startPos.y - currentPos.y));
    onChange({ x, y, w, h });
  };

  const applyPreset = (preset: "whole" | "center" | "top" | "bottom") => {
    if (preset === "whole") {
      onChange(null);
    } else if (preset === "center") {
      onChange({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
    } else if (preset === "top") {
      onChange({ x: 0, y: 0, w: 1, h: 0.5 });
    } else if (preset === "bottom") {
      onChange({ x: 0, y: 0.5, w: 1, h: 0.5 });
    }
  };

  const drawX = isDrawing ? Math.min(startPos.x, currentPos.x) : activeArea.x;
  const drawY = isDrawing ? Math.min(startPos.y, currentPos.y) : activeArea.y;
  const drawW = isDrawing ? Math.abs(startPos.x - currentPos.x) : activeArea.w;
  const drawH = isDrawing ? Math.abs(startPos.y - currentPos.y) : activeArea.h;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => applyPreset("whole")}
          className={cn(!value && "border-primary text-primary bg-primary/5")}
        >
          {t("presetWholeScreen")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => applyPreset("center")}
          className={cn(value?.x === 0.25 && value?.y === 0.25 && "border-primary text-primary bg-primary/5")}
        >
          {t("presetCenter")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => applyPreset("top")}
          className={cn(value?.x === 0 && value?.y === 0 && value?.h === 0.5 && "border-primary text-primary bg-primary/5")}
        >
          {t("presetTopHalf")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => applyPreset("bottom")}
          className={cn(value?.x === 0 && value?.y === 0.5 && value?.h === 0.5 && "border-primary text-primary bg-primary/5")}
        >
          {t("presetBottomHalf")}
        </Button>
      </div>

      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className="relative w-full aspect-video rounded border bg-slate-950/80 cursor-crosshair overflow-hidden border-dashed border-slate-700 select-none flex items-center justify-center"
      >
        {camera && camera.id && camera.enabled ? (
          <div className="absolute inset-0 z-0 pointer-events-none w-full h-full">
            <CameraLiveView camera={camera} className="w-full h-full" />
          </div>
        ) : (
          <>
            <div className="absolute inset-0 opacity-10 bg-[linear-gradient(to_right,#808080_1px,transparent_1px),linear-gradient(to_bottom,#808080_1px,transparent_1px)] bg-[size:14px_24px]" />
            <div className="text-center text-slate-500 z-10 pointer-events-none space-y-1">
              <div className="text-[11px] uppercase tracking-wider font-semibold">CCTV Feed Area</div>
              <div className="text-[10px] opacity-75">Click & Drag to define custom ROI</div>
            </div>
          </>
        )}

        <div
          className="absolute border-2 border-primary bg-primary/15 pointer-events-none transition-all duration-75 flex items-start p-1.5 z-20"
          style={{
            left: `${drawX * 100}%`,
            top: `${drawY * 100}%`,
            width: `${drawW * 100}%`,
            height: `${drawH * 100}%`,
          }}
        >
          <div className="bg-primary text-[9px] text-primary-foreground font-mono px-1 rounded font-semibold pointer-events-none select-none">
            ROI ({(drawW * 100).toFixed(0)}% x {(drawH * 100).toFixed(0)}%)
          </div>
        </div>
      </div>
    </div>
  );
}

function UnifiedMotionEditor({
  cameraId,
  cameraEnabled,
  value,
  onChange,
}: {
  cameraId: string;
  cameraEnabled: boolean;
  value: MotionArea[];
  onChange: (areas: MotionArea[]) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [connected, setConnected] = useState(false);
  const [activity, setActivity] = useState(0);
  const [mode, setMode] = useState<"none" | "polygon" | "rect">("none");
  const [isDrawingRect, setIsDrawingRect] = useState(false);
  const [rectStart, setRectStart] = useState({ x: 0, y: 0 });
  const [rectCurrent, setRectCurrent] = useState({ x: 0, y: 0 });
  const [polyPoints, setPolyPoints] = useState<{ x: number; y: number }[]>([]);
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null);
  const [isHoveringZone, setIsHoveringZone] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  const boxesRef = useRef<Array<{ x: number; y: number; w: number; h: number; blocks?: number }>>([]);
  const frameDims = useRef({ width: 640, height: 480 });

  // Build MJPEG src URL
  const mjpegSrc = useMemo(() => {
    const token = localStorage.getItem("cctv-lite-token") || "";
    const base = (typeof window !== "undefined" && ["5173", "5174", "8080"].includes(window.location.port))
      ? `${window.location.protocol}//${window.location.hostname}:4200`
      : "";
    return `${base}/api/streams/${cameraId}/video.mjpg?token=${encodeURIComponent(token)}`;
  }, [cameraId]);

  // Reset image loaded status on stream URL change
  useEffect(() => {
    setImgLoaded(false);
  }, [mjpegSrc]);

  // SSE for motion events
  useEffect(() => {
    if (!cameraId || !cameraEnabled) return;
    const token = localStorage.getItem("cctv-lite-token") || "";
    const base = (typeof window !== "undefined" && ["5173", "5174", "8080"].includes(window.location.port))
      ? `${window.location.protocol}//${window.location.hostname}:4200`
      : "";
    const url = `${base}/api/streams/${cameraId}/events?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    es.onopen = () => setConnected(true);
    es.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        if (data.connected) return;
        if (data.boxes) boxesRef.current = data.boxes;
        if (data.frame) frameDims.current = data.frame;
        if (data.activity != null) setActivity(data.activity);
      } catch { /* ignore */ }
    };
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, [cameraId, cameraEnabled]);

  // Canvas overlay draw loop
  useEffect(() => {
    let raf: number;
    const draw = () => {
      const canvas = canvasRef.current;
      const img = imgRef.current;
      if (!canvas || !img) {
        raf = requestAnimationFrame(draw);
        return;
      }

      const rect = img.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);

      if (w === 0 || h === 0) {
        raf = requestAnimationFrame(draw);
        return;
      }

      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        raf = requestAnimationFrame(draw);
        return;
      }

      ctx.clearRect(0, 0, w, h);

      // 1. Draw existing exclusion zones (Red)
      const activeAreas = value || [];
      activeAreas.forEach((zone, idx) => {
        if (zone.enabled === false) return;
        if (zone.type === "polygon" && zone.points && zone.points.length > 2) {
          ctx.fillStyle = "rgba(239, 68, 68, 0.22)";
          ctx.strokeStyle = "rgba(239, 68, 68, 0.95)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(zone.points[0].x * w, zone.points[0].y * h);
          for (let i = 1; i < zone.points.length; i++) {
            ctx.lineTo(zone.points[i].x * w, zone.points[i].y * h);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          // Draw a small DELETE label
          ctx.fillStyle = "#ff8888";
          ctx.font = "bold 9px monospace";
          ctx.fillText(`MASK ${idx + 1}`, zone.points[0].x * w + 5, zone.points[0].y * h + 12);
        } else if (zone.x != null && zone.y != null && zone.w != null && zone.h != null) {
          ctx.fillStyle = "rgba(239, 68, 68, 0.18)";
          ctx.strokeStyle = "rgba(239, 68, 68, 0.95)";
          ctx.lineWidth = 1.5;
          const zx = zone.x * w;
          const zy = zone.y * h;
          const zw = zone.w * w;
          const zh = zone.h * h;
          ctx.fillRect(zx, zy, zw, zh);
          ctx.strokeRect(zx, zy, zw, zh);

          ctx.fillStyle = "#ff8888";
          ctx.font = "bold 9px monospace";
          ctx.fillText(`MASK ${idx + 1}`, zx + 5, zy + 12);
        }
      });

      // 2. Draw in-progress drawing polygon (Yellow/Orange)
      if (mode === "polygon" && polyPoints.length > 0) {
        const previewPoints = hoverPoint ? [...polyPoints, hoverPoint] : polyPoints;
        ctx.fillStyle = "rgba(251, 191, 36, 0.12)";
        ctx.strokeStyle = "rgba(251, 191, 36, 0.95)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(previewPoints[0].x * w, previewPoints[0].y * h);
        for (let i = 1; i < previewPoints.length; i++) {
          ctx.lineTo(previewPoints[i].x * w, previewPoints[i].y * h);
        }
        if (previewPoints.length >= 3) {
          ctx.closePath();
        }
        ctx.stroke();
        if (previewPoints.length >= 3) {
          ctx.fill();
        }

        // Draw dots
        ctx.fillStyle = "#fcd34d";
        for (const p of previewPoints) {
          ctx.beginPath();
          ctx.arc(p.x * w, p.y * h, 4, 0, Math.PI * 2);
          ctx.fill();
        }

        // Highlight first point if hover is close (close indicator)
        if (polyPoints.length >= 3 && hoverPoint) {
          const first = polyPoints[0];
          const dx = hoverPoint.x - first.x;
          const dy = hoverPoint.y - first.y;
          if (Math.sqrt(dx * dx + dy * dy) < 0.03) {
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(first.x * w, first.y * h, 7, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }

      // 3. Draw in-progress rectangle (dashed Orange/Yellow)
      if (mode === "rect" && isDrawingRect) {
        ctx.strokeStyle = "rgba(251, 191, 36, 0.9)";
        ctx.fillStyle = "rgba(251, 191, 36, 0.15)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        const rx = Math.min(rectStart.x, rectCurrent.x) * w;
        const ry = Math.min(rectStart.y, rectCurrent.y) * h;
        const rw = Math.abs(rectStart.x - rectCurrent.x) * w;
        const rh = Math.abs(rectStart.y - rectCurrent.y) * h;
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.setLineDash([]); // Reset dash
      }

      // 4. Draw real-time motion bounding boxes (Green)
      if (boxesRef.current.length > 0) {
        const fw = frameDims.current.width || 640;
        const fh = frameDims.current.height || 480;
        const sx = w / fw;
        const sy = h / fh;

        ctx.strokeStyle = "rgba(34, 197, 94, 0.98)";
        ctx.fillStyle = "rgba(34, 197, 94, 0.15)";
        ctx.lineWidth = 2;
        ctx.font = "bold 10px monospace";
        for (const box of boxesRef.current) {
          const bx = box.x * sx;
          const by = box.y * sy;
          const bw = box.w * sx;
          const bh = box.h * sy;
          ctx.strokeRect(bx, by, bw, bh);
          ctx.fillRect(bx, by, bw, bh);

          ctx.fillStyle = "rgba(22, 163, 74, 0.9)";
          const labelWidth = Math.max(70, String(box.blocks || "").length * 6 + 45);
          ctx.fillRect(bx, Math.max(0, by - 16), labelWidth, 16);
          ctx.fillStyle = "#ffffff";
          ctx.fillText(`motion ${box.blocks || ""}`, bx + 4, Math.max(12, by - 4));
          ctx.fillStyle = "rgba(34, 197, 94, 0.15)"; // restore fill
        }
      }

      raf = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(raf);
  }, [value, mode, polyPoints, hoverPoint, isDrawingRect, rectStart, rectCurrent]);

  if (!cameraId || !cameraEnabled) {
    return (
      <div className="relative w-full aspect-video rounded-md border border-dashed border-slate-700 bg-slate-950/80 flex items-center justify-center">
        <div className="text-center text-slate-500 max-w-sm px-4 space-y-1">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-400">Smart Preview & Masking</div>
          <div className="text-[10px] opacity-75">
            Simpan dan aktifkan kamera terlebih dahulu untuk menampilkan video pratinjau langsung & menggambar area masking.
          </div>
        </div>
      </div>
    );
  }

  const getRelativeCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    return { x, y };
  };

  const isPointInPolygon = (p: { x: number; y: number }, points: { x: number; y: number }[]) => {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i].x, yi = points[i].y;
      const xj = points[j].x, yj = points[j].y;
      const intersect = ((yi > p.y) !== (yj > p.y))
          && (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  };

  const removeArea = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  // Mouse handlers for drawing rect
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (mode !== "rect") return;
    const coords = getRelativeCoords(e);
    if (!coords) return;
    setRectStart(coords);
    setRectCurrent(coords);
    setIsDrawingRect(true);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getRelativeCoords(e);
    if (!coords) return;

    if (mode === "rect" && isDrawingRect) {
      setRectCurrent(coords);
    } else if (mode === "polygon") {
      setHoverPoint(coords);
    }

    // Hover detection for existing zones
    if (mode === "none" || (mode === "polygon" && polyPoints.length === 0)) {
      let hovering = false;
      for (const zone of value) {
        if (zone.type === "polygon" && zone.points) {
          if (isPointInPolygon(coords, zone.points)) {
            hovering = true;
            break;
          }
        } else if (zone.x != null && zone.y != null && zone.w != null && zone.h != null) {
          if (coords.x >= zone.x && coords.x <= zone.x + zone.w && coords.y >= zone.y && coords.y <= zone.y + zone.h) {
            hovering = true;
            break;
          }
        }
      }
      setIsHoveringZone(hovering);
    } else {
      setIsHoveringZone(false);
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (mode !== "rect" || !isDrawingRect) return;
    setIsDrawingRect(false);
    const coords = getRelativeCoords(e);
    if (!coords) return;

    const x = Math.min(rectStart.x, coords.x);
    const y = Math.min(rectStart.y, coords.y);
    const w = Math.max(0.01, Math.abs(rectStart.x - coords.x));
    const h = Math.max(0.01, Math.abs(rectStart.y - coords.y));

    if (w > 0.02 && h > 0.02) {
      onChange([...value, { type: "rect", x, y, w, h, enabled: true, name: `Mask Kotak ${value.length + 1}` }]);
    }
  };

  const finishPolygon = () => {
    if (polyPoints.length < 3) return;
    onChange([...value, { type: "polygon", points: polyPoints, enabled: true, name: `Mask Polygon ${value.length + 1}` }]);
    setPolyPoints([]);
    setHoverPoint(null);
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getRelativeCoords(e);
    if (!coords) return;

    if (mode === "polygon") {
      // Check if clicking near first point to close
      if (polyPoints.length >= 3) {
        const first = polyPoints[0];
        const dx = coords.x - first.x;
        const dy = coords.y - first.y;
        if (Math.sqrt(dx * dx + dy * dy) < 0.03) {
          finishPolygon();
          return;
        }
      }
      setPolyPoints((prev) => [...prev, coords]);
    } else if (mode === "none" || (mode === "rect" && !isDrawingRect)) {
      // Check if clicking existing zone to delete
      for (let i = value.length - 1; i >= 0; i--) {
        const zone = value[i];
        let hit = false;
        if (zone.type === "polygon" && zone.points) {
          hit = isPointInPolygon(coords, zone.points);
        } else if (zone.x != null && zone.y != null && zone.w != null && zone.h != null) {
          hit = coords.x >= zone.x && coords.x <= zone.x + zone.w && coords.y >= zone.y && coords.y <= zone.y + zone.h;
        }
        if (hit) {
          removeArea(i);
          return;
        }
      }
    }
  };

  const undoPoint = () => {
    setPolyPoints((prev) => prev.slice(0, -1));
  };

  return (
    <div className="space-y-3">
      {/* Drawing Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={mode === "polygon" ? "default" : "outline"}
          size="sm"
          onClick={() => {
            setPolyPoints([]);
            setHoverPoint(null);
            setMode(mode === "polygon" ? "none" : "polygon");
          }}
          className="text-[11px] h-7"
        >
          ✏️ Gambar Polygon
        </Button>
        <Button
          type="button"
          variant={mode === "rect" ? "default" : "outline"}
          size="sm"
          onClick={() => {
            setMode(mode === "rect" ? "none" : "rect");
          }}
          className="text-[11px] h-7"
        >
          ▭ Gambar Kotak
        </Button>

        {mode === "polygon" && polyPoints.length > 0 && (
          <>
            <Button type="button" variant="outline" size="sm" onClick={undoPoint} className="text-[11px] h-7">
              ↩ Undo
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={finishPolygon}
              disabled={polyPoints.length < 3}
              className="text-[11px] h-7 bg-green-600 hover:bg-green-700 text-white font-medium animate-pulse"
            >
              ✓ Simpan Polygon ({polyPoints.length} titik)
            </Button>
          </>
        )}

        <div className="flex-1" />
        <span className="text-xs text-muted-foreground font-mono">
          {value.length} Mask Active
        </span>
        {value.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange([])}
            className="text-[11px] text-destructive hover:bg-destructive/10 h-7"
          >
            Hapus Semua
          </Button>
        )}
      </div>

      {/* Editor & Live Preview Stage */}
      <div className="relative w-full aspect-video border bg-slate-950 rounded-lg overflow-hidden border-slate-800 select-none">
        <img
          ref={imgRef}
          src={mjpegSrc}
          alt="Live MJPEG"
          className="w-full h-full object-contain block"
          crossOrigin="anonymous"
          onLoad={() => setImgLoaded(true)}
        />
        
        {!imgLoaded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 text-slate-400 gap-2 z-0">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-700 border-t-primary" />
            <span className="text-[10px] uppercase tracking-wider font-semibold">Menghubungkan Stream MJPEG...</span>
          </div>
        )}

        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onClick={handleCanvasClick}
          className="absolute inset-0 w-full h-full z-10"
          style={{
            cursor: mode === "polygon" ? "crosshair" : mode === "rect" ? "crosshair" : isHoveringZone ? "pointer" : "default"
          }}
        />

        {/* SSE connection indicator */}
        <div className={cn(
          "absolute top-2 left-2 px-2 py-0.5 rounded text-[9px] font-mono font-bold z-20 transition-all",
          connected ? "bg-green-600/80 text-white" : "bg-red-600/80 text-white"
        )}>
          {connected ? "● LIVE STREAM DETECT" : "○ RECONNECTING..."}
        </div>
        
        <div className="absolute top-2 right-2 px-2 py-0.5 rounded bg-black/60 text-[9px] font-mono text-green-400 z-20">
          Activity: {activity} blocks
        </div>

        {/* Helper guide */}
        {mode !== "none" && (
          <div className="absolute bottom-2 left-2 right-2 bg-black/85 border border-slate-700/50 backdrop-blur-sm px-2 py-1.5 rounded text-[10px] text-yellow-200 z-20 animate-fade-in font-medium">
            {mode === "polygon"
              ? "💡 Klik pada video untuk menambah titik. Klik lingkaran titik awal (pertama) untuk menyimpan polygon mask."
              : "💡 Klik dan seret mouse pada video untuk menggambar kotak mask."}
          </div>
        )}
      </div>

      {/* Ignore Areas list */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {value.map((area, idx) => (
            <div
              key={idx}
              className="flex items-center gap-1.5 text-[10px] bg-red-950/40 text-red-200 border border-red-500/30 px-2 py-0.5 rounded font-mono"
            >
              <span>{area.name || `Mask ${idx + 1}`} ({area.type === "polygon" ? `${area.points?.length}pt` : "rect"})</span>
              <button
                type="button"
                onClick={() => removeArea(idx)}
                className="text-red-400 hover:text-red-200 font-bold ml-1 text-xs"
                title="Hapus area ini"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
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
