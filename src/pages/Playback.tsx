import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useTranslation } from "@/hooks/useTranslation";
import { useAuth } from "@/features/auth/store";
import { PlaybackProvider, usePlayback } from "@/features/playback/context/PlaybackContext";

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
    selectedCameraId, selectedDate, playbackWindowMinutes, playbackWindowCenterTs,
    setLoading, setError, setCurrentPlaybackTs, setCurrentRecordingTime, setTimelineCenterTs,
    setPlaybackInfo, setEvents, setActivePosterUrl, setJumpToTimeTrigger,
    activeSnapshot, setActiveSnapshot,
    deleteEventTarget, setDeleteEventTarget,
    loadPlaybackTrigger, setLoadPlaybackTrigger
  } = usePlayback();

  const location = useLocation();
  const effectiveState = location.state as { cameraId?: string; date?: string; timestamp?: number; eventSeek?: boolean } | null;
  const initialSeekDone = React.useRef(false);

  const loadPlaybackSegments = async () => {
    if (!selectedCameraId) return;
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
        const centerSec = Math.floor(playbackWindowCenterTs / 1000);
        start = centerSec - halfWindow;
        end = centerSec + halfWindow;
      }

      // Fetch playback segments metadata
      const info = await streamApi.playbackInfo(selectedCameraId, selectedDate, start, end);
      setPlaybackInfo(info);

      if (info.hasRecording) {
        let startTs = info.firstSegmentUnixTime;
        if (effectiveState?.eventSeek && effectiveState?.timestamp && !initialSeekDone.current) {
          startTs = effectiveState.timestamp;
        }
        if (startTs) {
          setCurrentPlaybackTs(startTs);
          setCurrentRecordingTime(new Date(startTs * 1000).toLocaleTimeString("id-ID", { hour12: false }));
        }
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
    if (!selectedCameraId) return;
    try {
      const allEvents = await eventApi.list();
      const filtered = allEvents.filter((e) => {
        const eventLocalDate = new Date(e.ts).toLocaleDateString("sv-SE");
        return (
          e.cameraId === selectedCameraId &&
          eventLocalDate === selectedDate
        );
      });
      filtered.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
      setEvents(filtered);

      if (effectiveState?.eventSeek && effectiveState?.timestamp && !initialSeekDone.current) {
        const targetTs = effectiveState.timestamp;
        const closestEvent = filtered.find(e => {
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
  }, [selectedCameraId, selectedDate, playbackWindowMinutes, playbackWindowCenterTs]);

  React.useEffect(() => {
    loadEvents();
  }, [selectedCameraId, selectedDate]);

  React.useEffect(() => {
    if (!selectedCameraId) {
      setLoading(true);
      eventApi.list()
        .then((allEvents) => {
          const filtered = allEvents.filter((e) => e.type !== "sound");
          filtered.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
          setEvents(filtered);
        })
        .catch((err) => {
          console.error("Failed to load global events", err);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [selectedCameraId]);

  const confirmDeleteEvent = async () => {
    if (!deleteEventTarget) return;
    try {
      await eventApi.remove(deleteEventTarget.id);
      toast.success(t("deleteEventSuccess"));
      setEvents((prev) => prev.filter((e) => e.id !== deleteEventTarget.id));
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
          <VideoPlayer />

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
