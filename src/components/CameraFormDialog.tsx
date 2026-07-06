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

  // Smart Detection preview filter toggles (now synced with form.detectionModes)
  const [sdShowPerson, setSdShowPerson] = useState(camera?.detectionModes?.includes("human") ?? true);
  const [sdShowPet, setSdShowPet] = useState(camera?.detectionModes?.includes("pet") ?? true);
  const [sdShowObject, setSdShowObject] = useState(camera?.detectionModes?.includes("object") ?? true);
  const [sdShowMotion, setSdShowMotion] = useState(camera?.detectionModes?.includes("pixel") ?? true);
  const [sdAiSensitivity, setSdAiSensitivity] = useState(50);
  const [sdMotionSensitivity, setSdMotionSensitivity] = useState(10);

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
      aiSensitivity: form.aiSensitivity,
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
              <TabsTrigger value="stream" className="text-xs">Stream Setup</TabsTrigger>
              <TabsTrigger value="smart" className="text-xs">Smart Detection</TabsTrigger>
              <TabsTrigger value="alerts" className="text-xs">Alerts & Storage</TabsTrigger>
            </TabsList>

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

              </div>
            </TabsContent>

            <TabsContent value="stream" className="flex-1 overflow-y-auto px-1 space-y-4 data-[state=active]:block data-[state=inactive]:hidden">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

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

              </div>
            </TabsContent>

            <TabsContent value="alerts" className="flex-1 overflow-y-auto px-1 space-y-4 data-[state=active]:block data-[state=inactive]:hidden">
              <div className="space-y-4 max-w-3xl">
                {/* Recording Configuration Card */}
                <div className="rounded-md border p-4 space-y-4">
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
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div className="min-w-0 pr-2">
                    <Label className="text-sm font-semibold">{t("enableNotifications")}</Label>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {t("enableNotificationsHelp")}
                    </p>
                  </div>
                  <Switch checked={form.enableNotifications}
                    onCheckedChange={(v) => setForm({ ...form, enableNotifications: v })} />
                </div>
              </div>
            </TabsContent>

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
                          <SelectItem value="Auto">{t("all")}</SelectItem>
                          <SelectItem value="720p">720p</SelectItem>
                          <SelectItem value="480p">{t("detectResStandard")}</SelectItem>
                          <SelectItem value="360p">{t("detectResLight")}</SelectItem>
                          <SelectItem value="144p">{t("detectResMinimal")}</SelectItem>
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

                {/* ──── Smart Detection Live View & Masking Area ──── */}
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

          <div className="mt-4 pt-4 border-t space-y-4 shrink-0">
            <div className="rounded-md border bg-muted/30 p-3 space-y-2.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{t("urlPreview")}</div>
              <UrlRow icon={<Link2 className="h-3.5 w-3.5" />} label={t("originalSource")} value={sourceUrlPreview} tone="primary" />
              {form.sourceType === "RTSP+ONVIF" && (
                <UrlRow icon={<Link2 className="h-3.5 w-3.5" />} label="ONVIF Endpoint" value={onvifUrlPreview} />
              )}
              <UrlRow icon={<Radio className="h-3.5 w-3.5" />} label={`Restream (${form.streamType})`} value={restreamUrl} tone="success" />
            </div>

            {camera && form.sourceType === "RTSP+ONVIF" && form.enablePTZ && (
              <div className="rounded-md border p-3">
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
