import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useTranslation } from "@/hooks/useTranslation";
import { useAuth } from "@/features/auth/store";
import { usePlaybackStore } from "@/features/playback/store/usePlaybackStore";
import { useShallow } from "zustand/react/shallow";

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
    loadPlaybackTrigger, setLoadPlaybackTrigger,
    isDownloadFormOpen, setIsDownloadFormOpen,
    setSelectedCameraId, setSelectedDate, setPlaybackWindowMinutes, setPlaybackWindowCenterTs
  } = usePlaybackStore(useShallow(s => ({
    selectedCameraId: s.selectedCameraId, selectedDate: s.selectedDate, playbackWindowMinutes: s.playbackWindowMinutes, playbackWindowCenterTs: s.playbackWindowCenterTs,
    setLoading: s.setLoading, setError: s.setError, setCurrentPlaybackTs: s.setCurrentPlaybackTs, setCurrentRecordingTime: s.setCurrentRecordingTime, setTimelineCenterTs: s.setTimelineCenterTs,
    setPlaybackInfo: s.setPlaybackInfo, setEvents: s.setEvents, setActivePosterUrl: s.setActivePosterUrl, setJumpToTimeTrigger: s.setJumpToTimeTrigger,
    activeSnapshot: s.activeSnapshot, setActiveSnapshot: s.setActiveSnapshot,
    deleteEventTarget: s.deleteEventTarget, setDeleteEventTarget: s.setDeleteEventTarget,
    loadPlaybackTrigger: s.loadPlaybackTrigger, setLoadPlaybackTrigger: s.setLoadPlaybackTrigger,
    isDownloadFormOpen: s.isDownloadFormOpen, setIsDownloadFormOpen: s.setIsDownloadFormOpen,
    setSelectedCameraId: s.setSelectedCameraId, setSelectedDate: s.setSelectedDate, setPlaybackWindowMinutes: s.setPlaybackWindowMinutes, setPlaybackWindowCenterTs: s.setPlaybackWindowCenterTs
  })));

  const location = useLocation();
  const effectiveState = location.state as { cameraId?: string; date?: string; timestamp?: number; eventSeek?: boolean } | null;
  const initialSeekDone = React.useRef(false);

  React.useEffect(() => {
    if (effectiveState) {
      if (effectiveState.cameraId && effectiveState.cameraId !== selectedCameraId) {
        setSelectedCameraId(effectiveState.cameraId);
      }
      if (effectiveState.date && effectiveState.date !== selectedDate) {
        setSelectedDate(effectiveState.date);
      }
      if (effectiveState.eventSeek) {
        setPlaybackWindowMinutes("15");
        setPlaybackWindowCenterTs(effectiveState.timestamp || null);
      }
    }
  }, [effectiveState, selectedCameraId, selectedDate]);

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
        start = playbackWindowCenterTs - halfWindow;
        end = playbackWindowCenterTs + halfWindow;
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
    <div className="flex flex-col h-[calc(100dvh-160px)] md:h-[calc(100vh-112px)] w-full max-w-7xl mx-auto overflow-hidden">

      <div className="shrink-0 mb-2 sm:mb-4">
        <PlaybackControls />
      </div>

      {/* Layout: Fills remaining height. Fixed on all screens, no scrolling */}
      <div className="flex-1 flex flex-col lg:flex-row gap-3 lg:gap-6 min-h-0 min-w-0 overflow-hidden">
        
        {/* Main Content: Video Player ONLY */}
        <div className="flex-none lg:flex-1 h-[40%] sm:h-[50%] lg:h-auto min-w-0 min-h-0 flex flex-col">
          <div className="w-full h-full rounded-xl overflow-hidden shadow-sm bg-black">
            <VideoPlayer />
          </div>
        </div>

        {/* Right Sidebar: Vertical Timeline & Events */}
        <div className="flex-1 lg:w-[400px] xl:w-[450px] min-h-0 flex gap-2 lg:gap-3">
          {/* Vertical Timeline */}
          <div className="w-16 lg:w-24 shrink-0 min-h-0 h-full relative rounded-xl overflow-hidden">
            <div className="absolute inset-0">
              <TimelineCanvas />
            </div>
          </div>

          {/* Events List */}
          <div className="flex-1 min-h-0 min-w-0 flex flex-col">
            <EventList />
          </div>
        </div>
      </div>
      
      {/* Download Clip Dialog */}
      <Dialog open={isDownloadFormOpen} onOpenChange={setIsDownloadFormOpen}>
        <DialogContent className="sm:max-w-[425px] p-0 overflow-hidden bg-card border-border/40">
          <DownloadClipForm />
        </DialogContent>
      </Dialog>

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

  return <PlaybackContent />;
}
