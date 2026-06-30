import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "@/hooks/useTranslation";
import { eventApi } from "@/lib/api";
import { useCamerasQuery } from "@/features/cameras/queries";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Eye, Trash2, Video, Bell, Volume2, ShieldAlert, Sparkles, User, Footprints, Activity } from "lucide-react";
import { toast } from "sonner";
import type { SmartEvent } from "@/types";

const getClassificationLabel = (classification?: string, fallback?: string) => {
  switch (classification) {
    case "human":
      return "Deteksi Manusia";
    case "pet":
      return "Deteksi Hewan";
    case "pixel":
      return "Perubahan Gambar";
    default:
      return fallback || "Deteksi Gerakan";
  }
};

export default function Events() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { data: camerasData } = useCamerasQuery();
  const cameras = camerasData || [];

  const handleEventClick = (evt: SmartEvent) => {
    const dateObj = new Date(evt.ts);
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, "0");
    const day = String(dateObj.getDate()).padStart(2, "0");
    const dateStr = `${year}-${month}-${day}`;

    navigate("/playback", {
      state: {
        cameraId: evt.cameraId,
        date: dateStr,
        timestamp: Math.floor(dateObj.getTime() / 1000),
        eventSeek: true
      }
    });
  };

  const [events, setEvents] = useState<SmartEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterCamera, setFilterCamera] = useState("all");
  const [filterType, setFilterType] = useState("all");

  // Simulation controls
  const [selectedCameraId, setSelectedCameraId] = useState("");
  const [simulating, setSimulating] = useState(false);

  // Modal states
  const [activeSnapshot, setActiveSnapshot] = useState<string | null>(null);
  const [activeVideo, setActiveVideo] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const fetchEvents = () => {
    setLoading(true);
    eventApi.list()
      .then((data) => {
        setEvents(data);
      })
      .catch((err) => {
        console.error("Failed to load events", err);
        toast.error("Failed to load events");
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchEvents();
    // Poll events list every 5 seconds for live updates
    const timer = setInterval(() => {
      eventApi.list()
        .then((data) => setEvents(data))
        .catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // Trigger mock event
  const triggerSimulation = async (type: "motion" | "sound") => {
    if (!selectedCameraId) {
      toast.error("Please select a camera to simulate.");
      return;
    }
    setSimulating(true);
    try {
      const result = await eventApi.trigger(selectedCameraId, type);
      toast.success(t("eventTriggered"));
      setEvents((prev) => [result, ...prev]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to simulate event");
    } finally {
      setSimulating(false);
    }
  };

  // Delete single event
  const handleDelete = async (id: string) => {
    try {
      await eventApi.remove(id);
      setEvents((prev) => prev.filter((e) => e.id !== id));
      toast.success("Event deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete event");
    }
  };

  // Clear all events
  const handleClearAll = async () => {
    try {
      await eventApi.clear();
      setEvents([]);
      setShowClearConfirm(false);
      toast.success("All events cleared");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to clear events");
    }
  };

  // Filter logic
  const filteredEvents = events.filter((e) => {
    const matchCamera = filterCamera === "all" || e.cameraId === filterCamera;
    const matchType = filterType === "all" || e.type === filterType;
    return matchCamera && matchType;
  });

  return (
    <div className="space-y-6 max-w-6xl pb-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight">{t("smartEvents")}</h1>
          <p className="text-sm text-muted-foreground">{t("smartEventsDesc")}</p>
        </div>
        {events.length > 0 && (
          <Button variant="destructive" size="sm" onClick={() => setShowClearConfirm(true)}>
            <Trash2 className="h-4 w-4 mr-2" />
            {t("clearEvents")}
          </Button>
        )}
      </div>

      {/* Simulator Card & Filter Bar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="p-5 space-y-4 lg:col-span-1">
          <div className="flex items-center gap-2 font-medium text-sm text-primary">
            <Sparkles className="h-4 w-4" />
            <span>{t("simulateEvent")} (Beta Testing)</span>
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">{t("cameras")}</Label>
              <Select value={selectedCameraId} onValueChange={setSelectedCameraId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("selectSite")} />
                </SelectTrigger>
                <SelectContent>
                  {cameras.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} ({c.site})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => triggerSimulation("motion")}
                disabled={simulating || !selectedCameraId}
              >
                <ShieldAlert className="h-4 w-4 mr-1.5 text-warning" />
                {t("simulateMotion")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => triggerSimulation("sound")}
                disabled={simulating || !selectedCameraId}
              >
                <Volume2 className="h-4 w-4 mr-1.5 text-info" />
                {t("simulateSound")}
              </Button>
            </div>
          </div>
        </Card>

        <Card className="p-5 lg:col-span-2 flex flex-col md:flex-row md:items-end gap-4 justify-between">
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">{t("cameras")}</Label>
              <Select value={filterCamera} onValueChange={setFilterCamera}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allCameras")}</SelectItem>
                  {cameras.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">{t("eventType")}</Label>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allStatuses")}</SelectItem>
                  <SelectItem value="motion">{t("motion")}</SelectItem>
                  <SelectItem value="sound">{t("sound")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button variant="ghost" size="sm" onClick={fetchEvents} className="shrink-0 h-10">
            Refresh
          </Button>
        </Card>
      </div>

      {/* Events List */}
      {loading && events.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-10">{t("loading")}</div>
      ) : filteredEvents.length === 0 ? (
        <Card className="p-10 flex flex-col items-center justify-center text-center space-y-2 border-dashed">
          <Bell className="h-10 w-10 text-muted-foreground/60" />
          <h3 className="font-semibold text-lg">{t("noEvents")}</h3>
          <p className="text-sm text-muted-foreground max-w-sm">{t("noEventsSub")}</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredEvents.map((evt) => (
            <Card 
              key={evt.id} 
              className="overflow-hidden flex flex-col justify-between group hover:shadow-md hover:border-primary/50 transition-all duration-300 cursor-pointer"
              onClick={() => handleEventClick(evt)}
            >
              <div className="relative aspect-video bg-black/10 shrink-0">
                <img
                  src={eventApi.snapshotUrl(evt.id)}
                  alt="Snapshot"
                  loading="lazy"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = "https://images.unsplash.com/photo-1557597774-9d273605dfa9?auto=format&fit=crop&w=640&q=80";
                  }}
                />
                <div className="absolute top-2.5 left-2.5 flex gap-1.5 items-center">
                  <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider text-white ${
                    evt.type === "motion" ? "bg-warning" : "bg-info"
                  }`}>
                    {evt.type === "motion" ? t("motion") : t("sound")}
                  </span>
                </div>
              </div>

              <div className="p-4 space-y-3 flex-1 flex flex-col justify-between">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-medium text-sm leading-tight text-foreground">{evt.cameraName}</h3>
                    <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">{evt.site}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    {new Date(evt.ts).toLocaleString("id-ID", { hour12: false })}
                  </p>
                  {evt.type === "motion" && (
                    <div className="flex items-center gap-1.5 mt-2 text-xs font-semibold text-foreground/85 bg-accent/30 border border-border/40 px-2 py-0.5 rounded-sm w-max">
                      {evt.classification === "human" && <User className="h-3 w-3 text-red-500" />}
                      {evt.classification === "pet" && <Footprints className="h-3 w-3 text-amber-500" />}
                      {evt.classification === "pixel" && <Activity className="h-3 w-3 text-primary" />}
                      {!evt.classification && <Activity className="h-3 w-3 text-primary" />}
                      <span>{getClassificationLabel(evt.classification, evt.typeDescription)}</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 pt-2 border-t mt-auto">
                  <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={(e) => { e.stopPropagation(); setActiveSnapshot(evt.id); }}>
                    <Eye className="h-3.5 w-3.5 mr-1" />
                    Snapshot
                  </Button>
                  <Button variant="outline" size="sm" className="flex-1 text-xs text-primary hover:text-primary" onClick={(e) => { e.stopPropagation(); handleEventClick(evt); }}>
                    <Video className="h-3.5 w-3.5 mr-1" />
                    Playback
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 shrink-0"
                    onClick={(e) => { e.stopPropagation(); handleDelete(evt.id); }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Snapshot Preview Dialog */}
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

      {/* Video Playback Dialog */}
      <Dialog open={!!activeVideo} onOpenChange={(o) => !o && setActiveVideo(null)}>
        <DialogContent className="max-w-3xl p-1 bg-black">
          {activeVideo && (
            <div className="relative aspect-video flex items-center justify-center">
              <video
                src={eventApi.videoUrl(activeVideo)}
                controls
                autoPlay
                className="w-full h-full object-contain"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Clear All Confirmation Dialog */}
      <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("clearAllEventsConfirm")}</DialogTitle>
            <DialogDescription>{t("clearAllEventsDesc")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowClearConfirm(false)}>{t("cancel")}</Button>
            <Button variant="destructive" onClick={handleClearAll}>{t("delete")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
