import { useState, useEffect } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useTranslation } from "@/hooks/useTranslation";
import { useAuth } from "@/features/auth/store";
import { eventApi } from "@/lib/api";
import { useCamerasQuery } from "@/features/cameras/queries";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Eye, Trash2, Video, Bell, Volume2, ShieldAlert, Sparkles, User, Footprints, Activity, Loader2, Calendar, ChevronLeft, ChevronRight } from "lucide-react";
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
  const user = useAuth((s) => s.user);
  if (user && user.role !== "admin" && !user.permissions?.canViewEvents) {
    return <Navigate to="/" replace />;
  }

  const navigate = useNavigate();
  const { t, lang } = useTranslation();
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

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12;

  useEffect(() => {
    setCurrentPage(1);
  }, [filterCamera, filterType]);

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

  const totalPages = Math.ceil(filteredEvents.length / itemsPerPage) || 1;
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedEvents = filteredEvents.slice(startIndex, startIndex + itemsPerPage);

  return (
    <div className="space-y-6 max-w-7xl pb-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
            {t("smartEvents")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("smartEventsDesc")}</p>
        </div>
        {events.length > 0 && (
          <Button variant="destructive" size="sm" onClick={() => setShowClearConfirm(true)} className="shadow-lg shadow-red-500/10">
            <Trash2 className="h-4 w-4 mr-2" />
            {t("clearEvents")}
          </Button>
        )}
      </div>

      {/* Filter Bar */}
      <Card className="p-5 flex flex-col md:flex-row md:items-end gap-4 justify-between bg-card/65 backdrop-blur-md border border-border/40 dark:border-white/5 shadow-2xl rounded-xl">
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t("cameras")}</Label>
            <Select value={filterCamera} onValueChange={setFilterCamera}>
              <SelectTrigger className="bg-background/40 border border-border/40 dark:border-white/5 hover:bg-muted/40 dark:hover:bg-slate-955/60 text-foreground transition-colors">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover border border-border/40 dark:border-white/10 text-popover-foreground">
                <SelectItem value="all" className="hover:bg-muted dark:hover:bg-white/5 focus:bg-muted dark:focus:bg-white/5">{t("allCameras")}</SelectItem>
                {cameras.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="hover:bg-muted dark:hover:bg-white/5 focus:bg-muted dark:focus:bg-white/5">
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t("eventType")}</Label>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="bg-background/40 border border-border/40 dark:border-white/5 hover:bg-muted/40 dark:hover:bg-slate-955/60 text-foreground transition-colors">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover border border-border/40 dark:border-white/10 text-popover-foreground">
                <SelectItem value="all" className="hover:bg-muted dark:hover:bg-white/5 focus:bg-muted dark:focus:bg-white/5">{t("allStatuses")}</SelectItem>
                <SelectItem value="motion" className="hover:bg-muted dark:hover:bg-white/5 focus:bg-muted dark:focus:bg-white/5">{t("motion")}</SelectItem>
                <SelectItem value="sound" className="hover:bg-muted dark:hover:bg-white/5 focus:bg-muted dark:focus:bg-white/5">{t("sound")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button variant="ghost" size="sm" onClick={fetchEvents} className="shrink-0 h-10 border border-border/40 dark:border-white/5 hover:bg-muted dark:hover:bg-white/5 text-foreground">
          Refresh
        </Button>
      </Card>

      {/* Events List */}
      {loading && events.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">{t("loading")}</span>
        </div>
      ) : filteredEvents.length === 0 ? (
        <Card className="p-16 flex flex-col items-center justify-center text-center space-y-3 bg-muted/10 border-dashed border-border/40 dark:border-white/10 rounded-xl">
          <div className="p-4 bg-muted/30 dark:bg-slate-955/40 border border-border/40 dark:border-white/5 rounded-full text-muted-foreground">
            <Bell className="h-8 w-8" />
          </div>
          <h3 className="font-semibold text-lg text-foreground">{t("noEvents")}</h3>
          <p className="text-sm text-muted-foreground max-w-xs">{t("noEventsSub")}</p>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {paginatedEvents.map((evt) => {
              const dateObj = new Date(evt.ts);
              const dateStr = dateObj.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
              const timeStr = dateObj.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
              return (
                <Card 
                  key={evt.id} 
                  className="overflow-hidden flex flex-col justify-between bg-card/65 backdrop-blur-sm border border-border/40 dark:border-white/5 hover:border-primary/40 rounded-xl shadow-2xl relative group hover:shadow-[0_0_20px_rgba(59,130,246,0.1)] transition-all duration-500 cursor-pointer"
                  onClick={() => handleEventClick(evt)}
                >
                  {/* Snapshot Image Container */}
                  <div 
                    className="relative aspect-video bg-muted/20 overflow-hidden shrink-0 cursor-zoom-in"
                    onClick={(e) => { e.stopPropagation(); setActiveSnapshot(evt.id); }}
                  >
                    <img
                      src={eventApi.snapshotUrl(evt.id)}
                      alt="Snapshot"
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = "https://images.unsplash.com/photo-1557597774-9d273605dfa9?auto=format&fit=crop&w=640&q=80";
                      }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent opacity-60 transition-opacity duration-500" />
                    
                    {/* Event Type Badge */}
                    <div className="absolute top-3 left-3 flex gap-2 items-center z-5">
                      <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] uppercase font-bold tracking-wider bg-slate-950/85 backdrop-blur-md border border-white/10 text-white shadow-lg">
                        <span className={`h-1.5 w-1.5 rounded-full animate-pulse ${
                          evt.type === "sound" ? "bg-cyan-400 shadow-[0_0_8px_#06b6d4]" : "bg-amber-400 shadow-[0_0_8px_#f59e0b]"
                        }`} />
                        {evt.type === "sound" 
                          ? t("sound") 
                          : evt.type === "motion" 
                            ? t("motion") 
                            : (evt.type === "person" || evt.type === "human"
                              ? (lang === "id" ? "Orang" : "Person")
                              : ["cat", "dog", "bird", "horse", "sheep", "cow", "pet"].includes(evt.type)
                                ? (lang === "id" ? "Hewan" : "Pet")
                                : evt.type)}
                      </span>
                    </div>

                    {/* Motion Classification Badge */}
                    {evt.type !== "sound" && (
                      <div className="absolute top-3 right-3 z-5">
                        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-semibold bg-slate-950/85 backdrop-blur-md border border-white/10 text-white/90 shadow-lg">
                          {(evt.type === "person" || evt.type === "human") && <span className="h-1.5 w-1.5 rounded-full bg-rose-500 shadow-[0_0_6px_#f43f5e]" />}
                          {["cat", "dog", "bird", "horse", "sheep", "cow", "pet"].includes(evt.type) && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_#10b981]" />}
                          {evt.type === "pixel" && <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shadow-[0_0_6px_#3b82f6]" />}
                          {evt.type === "motion" && <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />}
                          {evt.type === "person" ? (lang === "id" ? "Orang" : "Person") : evt.type === "motion" || evt.type === "pixel" ? "Gerakan" : evt.type}
                        </span>
                      </div>
                    )}

                    {/* Hover Action Bar Overlay */}
                    <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-slate-950 via-slate-950/90 to-transparent flex items-center justify-between gap-2 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out z-10 backdrop-blur-sm">
                      <Button 
                        variant="secondary" 
                        size="sm" 
                        className="h-8 text-xs flex-1 bg-white/10 hover:bg-white/20 border border-white/10 text-white backdrop-blur-md" 
                        onClick={(e) => { e.stopPropagation(); setActiveSnapshot(evt.id); }}
                      >
                        <Eye className="h-3 w-3 mr-1.5" />
                        Snapshot
                      </Button>
                      <Button 
                        variant="default" 
                        size="sm" 
                        className="h-8 text-xs flex-1 bg-primary/80 hover:bg-primary border border-primary/20 text-white backdrop-blur-md shadow-lg shadow-primary/25" 
                        onClick={(e) => { e.stopPropagation(); handleEventClick(evt); }}
                      >
                        <Video className="h-3 w-3 mr-1.5" />
                        Playback
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-rose-400 hover:text-rose-300 hover:bg-rose-500/20 backdrop-blur-md border border-white/5 rounded-md"
                        onClick={(e) => { e.stopPropagation(); handleDelete(evt.id); }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Card Info Body */}
                  <div className="p-4 space-y-2.5 flex-1 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="font-semibold text-sm leading-tight text-foreground group-hover:text-primary transition-colors duration-300">
                          {evt.cameraName}
                        </h3>
                        <span className="text-[9px] uppercase tracking-wider font-bold text-muted-foreground bg-muted/40 border border-border/40 dark:bg-white/5 dark:border-white/10 px-2 py-0.5 rounded-full shrink-0">
                          {evt.site}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-1.5">
                        <Calendar className="h-3 w-3 text-muted-foreground/60" />
                        {dateStr} • {timeStr}
                      </p>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Pagination Controls Bar */}
          {totalPages > 1 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-5 border-t border-border/40 mt-8 bg-muted/10 p-4 rounded-xl">
              <span className="text-xs text-muted-foreground">
                Menampilkan <span className="font-semibold text-foreground">{startIndex + 1}</span> -{" "}
                <span className="font-semibold text-foreground">
                  {Math.min(startIndex + itemsPerPage, filteredEvents.length)}
                </span>{" "}
                dari <span className="font-semibold text-foreground">{filteredEvents.length}</span> event
              </span>

              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="h-8 w-8 p-0 bg-background border border-border/45 text-foreground hover:bg-muted disabled:opacity-30"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>

                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((page) => {
                    return (
                      page === 1 ||
                      page === totalPages ||
                      Math.abs(page - currentPage) <= 1
                    );
                  })
                  .map((page, idx, arr) => {
                    const showEllipsis = idx > 0 && page - arr[idx - 1] > 1;
                    return (
                      <div key={page} className="flex items-center gap-1">
                        {showEllipsis && <span className="text-muted-foreground px-1 text-xs">...</span>}
                        <Button
                          variant={currentPage === page ? "default" : "outline"}
                          size="sm"
                          onClick={() => setCurrentPage(page)}
                          className={`h-8 w-8 p-0 text-xs font-semibold ${
                            currentPage === page
                              ? "bg-primary text-primary-foreground"
                              : "bg-background border border-border/45 text-foreground hover:bg-muted"
                          }`}
                        >
                          {page}
                        </Button>
                      </div>
                    );
                  })}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="h-8 w-8 p-0 bg-background border border-border/45 text-foreground hover:bg-muted disabled:opacity-30"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
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
