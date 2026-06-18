import { useEffect, useState } from "react";
import { useSettings } from "@/features/settings/store";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Moon, Sun, Grid3x3, RefreshCw, Radio, Cctv as CctvIcon, Bell, HardDrive, Trash2, ShieldAlert } from "lucide-react";
import type { StreamType } from "@/types";
import { useTranslation } from "@/hooks/useTranslation";
import { eventApi, streamApi } from "@/lib/api";
import { toast } from "sonner";
import { useCamerasQuery } from "@/features/cameras/queries";
import { ConfirmDialog } from "@/components/ConfirmDialog";

export default function Settings() {
  const { settings, setSettings } = useSettings();
  const { t } = useTranslation();
  const { data: camerasData } = useCamerasQuery();
  const cameras = camerasData || [];

  const [retentionDays, setRetentionDays] = useState(7);
  const [maxStorageGb, setMaxStorageGb] = useState(5);
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  
  // New settings states
  const [recordingMode, setRecordingMode] = useState("continuous");
  const [preMotionSeconds, setPreMotionSeconds] = useState(15);
  const [postMotionSeconds, setPostMotionSeconds] = useState(15);
  const [segmentDuration, setSegmentDuration] = useState(5);
  const [enableAudioRecording, setEnableAudioRecording] = useState(false);
  const [sourceQualityRecording, setSourceQualityRecording] = useState(false);
  const [customStorageDir, setCustomStorageDir] = useState("");

  // Storage states
  const [selectedCameraId, setSelectedCameraId] = useState("");
  const [storageStatus, setStorageStatus] = useState<{
    usedBytes: number;
    maxBytes: number;
    recordingMode: string;
    maxStorageGb: number;
    retentionDays: number;
    diskTotal?: number;
    diskAvailable?: number;
  } | null>(null);
  
  const [loadingServerSettings, setLoadingServerSettings] = useState(true);
  const [savingServerSettings, setSavingServerSettings] = useState(false);
  const [runningCleanup, setRunningCleanup] = useState(false);

  // Modal confirmation states
  const [confirmDeleteAllOpen, setConfirmDeleteAllOpen] = useState(false);
  const [confirmDeleteTodayOpen, setConfirmDeleteTodayOpen] = useState(false);
  const [confirmCleanupOpen, setConfirmCleanupOpen] = useState(false);

  const fetchStorageStatus = () => {
    eventApi.getStorageStatus()
      .then((data) => setStorageStatus(data))
      .catch((err) => console.error("Failed to fetch storage status", err));
  };

  useEffect(() => {
    eventApi.getSettings()
      .then((data) => {
        setRetentionDays(data.retentionDays || 7);
        setMaxStorageGb(data.maxStorageGb || 5);
        setTelegramBotToken(data.telegramBotToken || "");
        setTelegramChatId(data.telegramChatId || "");
        setRecordingMode(data.recordingMode || "continuous");
        setPreMotionSeconds(data.preMotionSeconds || 15);
        setPostMotionSeconds(data.postMotionSeconds || 15);
        setSegmentDuration(data.segmentDuration || 5);
        setEnableAudioRecording(!!data.enableAudioRecording);
        setSourceQualityRecording(!!data.sourceQualityRecording);
        setCustomStorageDir(data.customStorageDir || "");
      })
      .catch((err) => {
        console.error("Failed to load server settings", err);
      })
      .finally(() => {
        setLoadingServerSettings(false);
      });

    fetchStorageStatus();
  }, []);

  const saveServerSettings = async () => {
    setSavingServerSettings(true);
    try {
      await eventApi.updateSettings({
        retentionDays,
        maxStorageGb,
        telegramBotToken,
        telegramChatId,
        recordingMode,
        preMotionSeconds,
        postMotionSeconds,
        segmentDuration,
        enableAudioRecording,
        sourceQualityRecording,
        customStorageDir,
      });
      toast.success(t("saveSettingsSuccess"));
      fetchStorageStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("saveSettingsFailed"));
    } finally {
      setSavingServerSettings(false);
    }
  };

  const handleManualCleanup = () => {
    setConfirmCleanupOpen(true);
  };

  const executeManualCleanup = async () => {
    setConfirmCleanupOpen(false);
    setRunningCleanup(true);
    try {
      await eventApi.runStorageCleanup();
      toast.success(t("manualDiskCleanupSuccess"));
      fetchStorageStatus();
    } catch (err) {
      toast.error(t("manualDiskCleanupFailed"));
    } finally {
      setRunningCleanup(false);
    }
  };

  const handleDeleteTodayRecordings = () => {
    if (!selectedCameraId) {
      toast.error(t("pleaseSelectCameraFirst"));
      return;
    }
    setConfirmDeleteTodayOpen(true);
  };

  const executeDeleteTodayRecordings = async () => {
    setConfirmDeleteTodayOpen(false);
    if (!selectedCameraId) return;
    const today = new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD
    try {
      const res = await streamApi.deleteTodayRecordings(selectedCameraId, today);
      toast.success(t("deleteTodaySuccess").replace("{n}", String(res.deletedCount || 0)));
      fetchStorageStatus();
    } catch (err) {
      toast.error(t("deleteTodayFailed"));
    }
  };

  const handleDeleteAllRecordings = () => {
    if (!selectedCameraId) {
      toast.error(t("pleaseSelectCameraFirst"));
      return;
    }
    setConfirmDeleteAllOpen(true);
  };

  const executeDeleteAllRecordings = async () => {
    setConfirmDeleteAllOpen(false);
    if (!selectedCameraId) return;
    try {
      await streamApi.deleteAllRecordings(selectedCameraId);
      toast.success(t("deleteAllSuccess"));
      fetchStorageStatus();
    } catch (err) {
      toast.error(t("deleteAllFailed"));
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const storagePercentage = storageStatus
    ? Math.min(100, (storageStatus.usedBytes / storageStatus.maxBytes) * 100)
    : 0;

  return (
    <div className="space-y-5 max-w-3xl pb-10">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight">{t("displaySettings")}</h1>
        <p className="text-sm text-muted-foreground">{t("displaySettingsSubtitle")}</p>
      </div>

      <Card className="p-5 space-y-1">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-md bg-primary/10 text-primary flex items-center justify-center">
              {settings.theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </div>
            <div>
              <Label className="font-medium">{t("themeMode")}</Label>
              <p className="text-xs text-muted-foreground">{t("themeModeDesc")}</p>
            </div>
          </div>
          <Switch checked={settings.theme === "dark"} onCheckedChange={(v) => setSettings({ theme: v ? "dark" : "light" })} />
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex items-start gap-3 mb-4">
          <div className="h-9 w-9 rounded-md bg-info/10 text-info flex items-center justify-center"><Grid3x3 className="h-4 w-4" /></div>
          <div>
            <Label className="font-medium">{t("gridCols")}</Label>
            <p className="text-xs text-muted-foreground">{t("gridColsDesc")}</p>
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
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("columns")}</span>
            </Label>
          ))}
        </RadioGroup>
      </Card>

      <Card className="p-5">
        <div className="flex items-start gap-3 mb-4">
          <div className="h-9 w-9 rounded-md bg-primary/10 text-primary flex items-center justify-center"><CctvIcon className="h-4 w-4" /></div>
          <div>
            <Label className="font-medium">{t("pageSizeLabel")}</Label>
            <p className="text-xs text-muted-foreground">{t("pageSizeLabelDesc")}</p>
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
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("camerasUnit")}</span>
            </Label>
          ))}
        </RadioGroup>
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-md bg-warning/10 text-warning flex items-center justify-center"><RefreshCw className="h-4 w-4" /></div>
            <div>
              <Label className="font-medium">{t("autoRefreshStats")}</Label>
              <p className="text-xs text-muted-foreground">{t("autoRefreshStatsDesc")}</p>
            </div>
          </div>
          <Switch checked={settings.autoRefresh} onCheckedChange={(v) => setSettings({ autoRefresh: v })} />
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex items-start gap-3 mb-3">
          <div className="h-9 w-9 rounded-md bg-success/10 text-success flex items-center justify-center"><Radio className="h-4 w-4" /></div>
          <div className="flex-1">
            <Label className="font-medium">{t("defaultStreamOutput")}</Label>
            <p className="text-xs text-muted-foreground">{t("defaultStreamOutputDesc")}</p>
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

      <div className="border-t pt-5 mt-5 space-y-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{t("smartEvents")}</h2>
          <p className="text-sm text-muted-foreground">{t("smartEventsDesc")}</p>
        </div>

        {loadingServerSettings ? (
          <div className="text-sm text-muted-foreground py-4">{t("loading")}</div>
        ) : (
          <div className="space-y-4">
            {/* Storage Retention & Recording Configuration */}
            <Card className="p-5 space-y-4">
              <div className="flex items-start gap-3 border-b pb-3 mb-1">
                <div className="h-9 w-9 rounded-md bg-primary/10 text-primary flex items-center justify-center">
                  <HardDrive className="h-4 w-4" />
                </div>
                <div>
                  <Label className="font-medium text-base">{t("recordingStorageSettings")}</Label>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="retentionDays">{t("retentionDays")}</Label>
                  <Input
                    id="retentionDays"
                    type="number"
                    min={1}
                    value={retentionDays}
                    onChange={(e) => setRetentionDays(Number(e.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maxStorageGb">{t("maxStorageGb")}</Label>
                  <Input
                    id="maxStorageGb"
                    type="number"
                    min={1}
                    value={maxStorageGb}
                    onChange={(e) => setMaxStorageGb(Number(e.target.value))}
                  />
                </div>



                <div className="space-y-2">
                  <Label htmlFor="segmentDuration">{t("segmentDurationLabel")}</Label>
                  <Input
                    id="segmentDuration"
                    type="number"
                    min={2}
                    max={15}
                    value={segmentDuration}
                    onChange={(e) => setSegmentDuration(Number(e.target.value))}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="preMotionSeconds">{t("preMotionOffset")}</Label>
                  <Input
                    id="preMotionSeconds"
                    type="number"
                    min={0}
                    max={60}
                    value={preMotionSeconds}
                    onChange={(e) => setPreMotionSeconds(Number(e.target.value))}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="postMotionSeconds">{t("postMotionOffset")}</Label>
                  <Input
                    id="postMotionSeconds"
                    type="number"
                    min={0}
                    max={60}
                    value={postMotionSeconds}
                    onChange={(e) => setPostMotionSeconds(Number(e.target.value))}
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="customStorageDir">{t("customStoragePath")}</Label>
                  <Input
                    id="customStorageDir"
                    type="text"
                    value={customStorageDir}
                    onChange={(e) => setCustomStorageDir(e.target.value)}
                    placeholder={t("customStoragePathPlaceholder")}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {t("customStoragePathHelp")}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div className="flex items-center justify-between border rounded-lg p-3">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">{t("recordAudioCctv")}</Label>
                    <p className="text-xs text-muted-foreground">{t("recordAudioCctvDesc")}</p>
                  </div>
                  <Switch
                    checked={enableAudioRecording}
                    onCheckedChange={setEnableAudioRecording}
                  />
                </div>

                <div className="flex items-center justify-between border rounded-lg p-3">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">{t("sourceQualityRecording")}</Label>
                    <p className="text-xs text-muted-foreground">{t("sourceQualityRecordingDesc")}</p>
                  </div>
                  <Switch
                    checked={sourceQualityRecording}
                    onCheckedChange={setSourceQualityRecording}
                  />
                </div>
              </div>
            </Card>

            {/* Visual Storage capacity and management panel */}
            <Card className="p-5 space-y-4">
              <div className="flex items-start gap-3 border-b pb-3 mb-1">
                <div className="h-9 w-9 rounded-md bg-info/10 text-info flex items-center justify-center">
                  <HardDrive className="h-4 w-4" />
                </div>
                <div>
                  <Label className="font-medium text-base">{t("storageCapacityManagement")}</Label>
                  <p className="text-xs text-muted-foreground">{t("storageCapacityDesc")}</p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-xs font-semibold">
                  <span>{t("capacityUsed")}</span>
                  <span>
                    {storageStatus
                      ? `${formatSize(storageStatus.usedBytes)} / ${formatSize(storageStatus.maxBytes)}`
                      : "Loading..."}
                  </span>
                </div>
                <div className="w-full bg-slate-950 border border-border/40 h-3.5 rounded-full overflow-hidden p-0.5 shadow-inner">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${storagePercentage}%`,
                      background: "linear-gradient(90deg, #10b981 0%, #f59e0b 60%, #ef4444 100%)",
                      backgroundSize: `${100 / Math.max(0.1, storagePercentage / 100)}% 100%`,
                      boxShadow: storagePercentage > 80 
                        ? "0 0 10px rgba(239, 68, 68, 0.6)" 
                        : storagePercentage > 50 
                        ? "0 0 10px rgba(245, 158, 11, 0.5)" 
                        : "0 0 10px rgba(16, 185, 129, 0.4)"
                    }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>{t("usedPercent").replace("{pct}", storagePercentage.toFixed(1))}</span>
                  <span>{t("autoCleanupNotice")}</span>
                </div>
                {storageStatus && storageStatus.diskTotal !== undefined && storageStatus.diskTotal > 0 && (
                  <div className="text-[10px] text-muted-foreground/80 mt-1 flex justify-end">
                    <span>
                      {t("serverDiskSpace")
                        .replace("{free}", formatSize(storageStatus.diskAvailable || 0))
                        .replace("{total}", formatSize(storageStatus.diskTotal))}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-4 border-t pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">{t("manualDiskCleanup")}</Label>
                    <p className="text-[11px] text-muted-foreground">
                      {t("manualDiskCleanupDesc")}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleManualCleanup}
                    disabled={runningCleanup}
                    className="shrink-0 h-8"
                  >
                    {runningCleanup && <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                    {t("runCleanup")}
                  </Button>
                </div>

                <div className="flex flex-col gap-3.5 bg-slate-950 p-3 rounded-lg border border-border/40 mt-1">
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs font-semibold text-warning flex items-center gap-1.5">
                      <ShieldAlert className="h-4 w-4" />
                      {t("deleteCameraRecordings")}
                    </Label>
                    <p className="text-[10px] text-muted-foreground">
                      {t("deleteCameraRecordingsDesc")}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <Select value={selectedCameraId} onValueChange={setSelectedCameraId}>
                      <SelectTrigger className="max-w-[200px] h-8 text-xs bg-background">
                        <SelectValue placeholder={t("selectCamera")} />
                      </SelectTrigger>
                      <SelectContent>
                        {cameras.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={handleDeleteTodayRecordings}
                      disabled={!selectedCameraId}
                      className="h-8 text-xs font-semibold"
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      {t("deleteToday")}
                    </Button>

                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={handleDeleteAllRecordings}
                      disabled={!selectedCameraId}
                      className="h-8 text-xs font-semibold"
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      {t("deleteAllRecordings")}
                    </Button>
                  </div>
                </div>
              </div>
            </Card>

            {/* Telegram settings */}
            <Card className="p-5 space-y-4">
              <div className="flex items-start gap-3 border-b pb-3 mb-1">
                <div className="h-9 w-9 rounded-md bg-info/10 text-info flex items-center justify-center">
                  <Bell className="h-4 w-4" />
                </div>
                <div>
                  <Label className="font-medium text-base">{t("telegramNotificationSettings")}</Label>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="telegramBotToken">{t("telegramBotToken")}</Label>
                  <Input
                    id="telegramBotToken"
                    type="password"
                    value={telegramBotToken}
                    onChange={(e) => setTelegramBotToken(e.target.value)}
                    placeholder="1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="telegramChatId">{t("telegramChatId")}</Label>
                  <Input
                    id="telegramChatId"
                    type="text"
                    value={telegramChatId}
                    onChange={(e) => setTelegramChatId(e.target.value)}
                    placeholder="-100123456789"
                  />
                </div>
              </div>
            </Card>

            <div className="flex justify-end">
              <Button onClick={saveServerSettings} disabled={savingServerSettings} className="bg-gradient-primary text-white">
                {savingServerSettings ? t("savingEllipsis") : t("saveSettings")}
              </Button>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmCleanupOpen}
        onOpenChange={setConfirmCleanupOpen}
        title={t("runCleanupConfirmTitle")}
        description={t("runCleanupConfirmDesc")}
        confirmText={t("runCleanup")}
        onConfirm={executeManualCleanup}
      />

      <ConfirmDialog
        open={confirmDeleteTodayOpen}
        onOpenChange={setConfirmDeleteTodayOpen}
        title={t("deleteTodayConfirmTitle")}
        description={t("deleteTodayConfirmDesc")}
        confirmText={t("delete")}
        variant="destructive"
        onConfirm={executeDeleteTodayRecordings}
      />

      <ConfirmDialog
        open={confirmDeleteAllOpen}
        onOpenChange={setConfirmDeleteAllOpen}
        title={t("deleteAllConfirmTitle")}
        description={t("deleteAllConfirmDesc")}
        confirmText={t("deleteAllRecordings")}
        variant="destructive"
        onConfirm={executeDeleteAllRecordings}
      />
    </div>
  );
}
