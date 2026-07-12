import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useTranslation } from "@/hooks/useTranslation";
import { useAuth } from "@/features/auth/store";
import { PlaybackProvider, usePlayback } from "@/features/playback/context/PlaybackContext";
import { cn } from "@/lib/utils";

// Components
import { PlaybackControls } from "@/features/playback/components/PlaybackControls";
import { VideoPlayer } from "@/features/playback/components/VideoPlayer";
import { TimelineCanvas } from "@/features/playback/components/TimelineCanvas";
import { EventList } from "@/features/playback/components/EventList";
import { DownloadClipForm } from "@/features/playback/components/DownloadClipForm";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { eventApi, streamApi } from "@/lib/api";
import { toast } from "sonner";

function PlaybackContent() {
  const { t, lang } = useTranslation();
  
  const {
    selectedCameraIds, selectedDate, playbackWindowMinutes, playbackWindowCenterTs,
    setLoading, setError, setCurrentPlaybackTs, setCurrentRecordingTime, setTimelineCenterTs,
    setPlaybackInfoMap, setEventsMap, setActivePosterUrl, setJumpToTimeTrigger,
    activeSnapshot, setActiveSnapshot,
    deleteEventTarget, setDeleteEventTarget,
    loadPlaybackTrigger, setLoadPlaybackTrigger
  } = usePlayback();

  const location = useLocation();
  const effectiveState = location.state as { cameraId?: string; date?: string; timestamp?: number; eventSeek?: boolean } | null;
  const initialSeekDone = React.useRef(false);

  const loadPlaybackSegments = async () => {
    if (!selectedCameraIds || selectedCameraIds.length === 0) {
      setPlaybackInfoMap({});
      return;
    }
    setLoading(true);
    setError(null);
    setActivePosterUrl(null);
    setCurrentPlaybackTs(null);
    setCurrentRecordingTime(null);
    setTimelineCenterTs(null);

    try {
      let start: number | undefined;
      let end: number | undefined;

      if (playbackWindowMinutes !== "none" && playbackWindowCenterTs !== null) {
        const halfWindow = (parseInt(playbackWindowMinutes, 10) * 60) / 2;
        start = playbackWindowCenterTs - halfWindow;
        end = playbackWindowCenterTs + halfWindow;
      }

      const newMap: Record<string, any> = {};
      let firstValidTs: number | null = null;

      await Promise.all(selectedCameraIds.map(async (camId) => {
        try {
          const info = await streamApi.playbackInfo(camId, selectedDate, start, end);
          newMap[camId] = info;
          if (info.hasRecording && firstValidTs === null) {
            firstValidTs = info.firstSegmentUnixTime;
          }
        } catch (e) {
          console.error(`Failed to load segments for ${camId}`, e);
        }
      }));

      setPlaybackInfoMap(newMap);

      let startTs = firstValidTs;
      if (effectiveState?.eventSeek && effectiveState?.timestamp && !initialSeekDone.current) {
        startTs = effectiveState.timestamp;
      }
      if (startTs) {
        setCurrentPlaybackTs(startTs);
        setCurrentRecordingTime(new Date(startTs * 1000).toLocaleTimeString("id-ID", { hour12: false }));
      }

      setLoadPlaybackTrigger((prev) => prev + 1); // trigger VideoPlayer to reinitialize HLS
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedLoadRecordings"));
      toast.error(t("failedFetchPlayback"));
    } finally {
      setLoading(false);
    }
  };

  const loadEvents = async () => {
    if (!selectedCameraIds || selectedCameraIds.length === 0) {
      setEventsMap({});
      return;
    }
    try {
      const allEvents = await eventApi.list();
      const newMap: Record<string, any[]> = {};
      
      let allFiltered: any[] = [];
      
      selectedCameraIds.forEach(camId => {
        const filtered = allEvents.filter((e) => {
          const eventLocalDate = new Date(e.ts).toLocaleDateString("sv-SE");
          return (
            e.cameraId === camId &&
            eventLocalDate === selectedDate
          );
        });
        filtered.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
        newMap[camId] = filtered;
        allFiltered = [...allFiltered, ...filtered];
      });
      
      setEventsMap(newMap);

      if (effectiveState?.eventSeek && effectiveState?.timestamp && !initialSeekDone.current) {
        const targetTs = effectiveState.timestamp;
        const closestEvent = allFiltered.find(e => {
          const eUnix = Math.floor(new Date(e.ts).getTime() / 1000);
          return Math.abs(eUnix - targetTs) <= 2;
        });
        if (closestEvent) {
          setActivePosterUrl(eventApi.snapshotUrl(closestEvent.id));
        }
        initialSeekDone.current = true;
      }
    } catch (err) {
      console.error("Failed to load events", err);
    }
  };

  React.useEffect(() => {
    loadPlaybackSegments();
  }, [selectedCameraIds, selectedDate, playbackWindowMinutes, playbackWindowCenterTs]);

  React.useEffect(() => {
    loadEvents();
  }, [selectedCameraIds, selectedDate]);

  React.useEffect(() => {
    if (!selectedCameraIds || selectedCameraIds.length === 0) {
      setLoading(true);
      eventApi.list()
        .then((allEvents) => {
          const filtered = allEvents.filter((e) => e.type !== "sound");
          filtered.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
          setEventsMap({ "global": filtered }); // Fallback to global
        })
        .catch((err) => {
          console.error("Failed to load global events", err);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [selectedCameraIds]);

  const confirmDeleteEvent = async () => {
    if (!deleteEventTarget) return;
    try {
      await eventApi.remove(deleteEventTarget.id);
      toast.success(t("deleteEventSuccess"));
      
      setEventsMap((prev) => {
        const newMap = { ...prev };
        if (newMap[deleteEventTarget.cameraId]) {
          newMap[deleteEventTarget.cameraId] = newMap[deleteEventTarget.cameraId].filter(e => e.id !== deleteEventTarget.id);
        }
        if (newMap["global"]) {
          newMap["global"] = newMap["global"].filter(e => e.id !== deleteEventTarget.id);
        }
        return newMap;
      });
      setDeleteEventTarget(null);
    } catch (err) {
      toast.error(t("failedDeleteEvent"));
    }
  };

  return (
    <div className="space-y-6 max-w-7xl pb-10 select-none">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight">
          {t("playback")}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {lang === "id" ? "Lihat rekaman ulang dari kamera" : "View playback from camera"}
        </p>
      </div>

      <PlaybackControls />

      {/* Responsive Layout */}
      <div className="flex flex-col lg:grid lg:grid-cols-3 gap-6 items-start h-[calc(100vh-64px)] lg:h-auto overflow-hidden lg:overflow-visible">
        {/* Left Column */}
        <div className="w-full lg:col-span-2 flex flex-col h-full min-h-0 lg:block lg:space-y-6 lg:pr-1 lg:pb-4">
          {selectedCameraIds.length === 0 ? (
            <div className="w-full aspect-video bg-black/90 flex flex-col items-center justify-center text-muted-foreground border border-border/40 rounded-xl">
              <span className="mb-2">Camera</span>
              <span>{(t as any)("selectCameraPrompt") || "Select cameras to view playback"}</span>
            </div>
          ) : (
            <div className={cn(
              "grid gap-2 w-full",
              selectedCameraIds.length === 1 ? "grid-cols-1" :
              selectedCameraIds.length === 2 ? "grid-cols-1 md:grid-cols-2" :
              "grid-cols-2"
            )}>
              {selectedCameraIds.map(camId => (
                <VideoPlayer key={camId} cameraId={camId} />
              ))}
            </div>
          )}

          {/* Desktop Timeline and Downloader */}
          <div className="hidden lg:block space-y-6 mt-4 lg:mt-0">
            <TimelineCanvas />
            <DownloadClipForm />
          </div>

          {/* Mobile Tabs */}
          <div className="lg:hidden flex-1 flex flex-col min-h-0 mt-4">
            <Tabs defaultValue="events" className="flex flex-col h-full">
              <TabsList className="grid grid-cols-2 w-full shrink-0">
                <TabsTrigger value="events">{lang === "id" ? "Kejadian" : "Events"}</TabsTrigger>
                <TabsTrigger value="timeline">{lang === "id" ? "Garis Waktu" : "Timeline"}</TabsTrigger>
              </TabsList>
              
              <TabsContent value="events" className="flex-1 overflow-y-auto mt-4 outline-none">
                 <EventList />
              </TabsContent>
              
              <TabsContent value="timeline" className="flex-1 overflow-y-auto mt-4 outline-none space-y-4 pb-8">
                 <TimelineCanvas />
                 <DownloadClipForm />
              </TabsContent>
            </Tabs>
          </div>
        </div>

        {/* Right Column: Scrollable Detection Events List (Desktop only) */}
        <div className="max-lg:hidden lg:col-span-1 lg:max-h-[calc(100vh-96px)] lg:overflow-y-auto pr-1 pb-4 scrollbar-thin">
          <EventList />
        </div>
      </div>

      {/* Zoomed Snapshot Dialog */}
      <Dialog open={!!activeSnapshot} onOpenChange={(o) => !o && setActiveSnapshot(null)}>
        <DialogContent className="max-w-3xl p-1 bg-black">
          {activeSnapshot && (
            <div className="relative aspect-video">
              <img
                src={eventApi.snapshotUrl(activeSnapshot)}
                alt="Full Snapshot"
                className="w-full h-full object-contain"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Konfirmasi Hapus Event */}
      <ConfirmDialog
        open={!!deleteEventTarget}
        onOpenChange={(o) => !o && setDeleteEventTarget(null)}
        title={t("deleteDetectionEvent")}
        description={t("deleteEventConfirmDesc")
          .replace("{camera}", deleteEventTarget?.cameraName || "")
          .replace("{time}", deleteEventTarget ? new Date(deleteEventTarget.ts).toLocaleTimeString("id-ID", { hour12: false }) : "")
        }
        confirmText={t("delete")}
        variant="destructive"
        onConfirm={confirmDeleteEvent}
      />
    </div>
  );
}

export default function Playback() {
  const user = useAuth((s) => s.user);

  if (user && user.role !== "admin" && !user.permissions?.canViewPlayback) {
    return <Navigate to="/" replace />;
  }

  return (
    <PlaybackProvider>
      <PlaybackContent />
    </PlaybackProvider>
  );
}
