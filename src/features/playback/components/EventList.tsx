import React, { useMemo } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { usePlayback } from "../context/PlaybackContext";
import { eventApi } from "@/lib/api";
import { SmartEvent } from "@/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Eye, Play, ChevronLeft, ChevronRight, User, Volume2, Footprints, Car, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

export const getClassificationBadge = (classification?: string, t?: any) => {
  if (classification === "person" || classification === "human") {
    return {
      icon: <User className="h-3 w-3 text-rose-500" />,
      label: t ? t("humanBadge") : "Manusia",
      bgColor: "bg-rose-500/10 border-rose-500/20 text-rose-500"
    };
  }
  if (classification === "sound") {
    return {
      icon: <Volume2 className="h-3 w-3 text-cyan-500" />,
      label: t ? t("sound") : "Suara",
      bgColor: "bg-cyan-500/10 border-cyan-500/20 text-cyan-500"
    };
  }
  if (classification && ["cat", "dog", "bird", "horse", "sheep", "cow", "pet"].includes(classification)) {
    return {
      icon: <Footprints className="h-3 w-3 text-emerald-500" />,
      label: t ? t("petBadge") : "Hewan/Objek",
      bgColor: "bg-emerald-500/10 border-emerald-500/20 text-emerald-500"
    };
  }
  if (classification && ["car", "motorcycle", "bus", "truck", "bicycle", "vehicle"].includes(classification)) {
    return {
      icon: <Car className="h-3 w-3 text-blue-500" />,
      label: t ? t("vehicleBadge") : "Kendaraan",
      bgColor: "bg-blue-500/10 border-blue-500/20 text-blue-500"
    };
  }
  if (classification === "pixel" || classification === "motion") {
    return {
      icon: <Activity className="h-3 w-3 text-amber-500" />,
      label: t ? t("pixelBadge") : "Gerakan",
      bgColor: "bg-amber-500/10 border-amber-500/20 text-amber-500"
    };
  }
  return {
    icon: <Activity className="h-3 w-3 text-amber-500" />,
    label: classification || (t ? t("motionBadge") : "Gerakan"),
    bgColor: "bg-amber-500/10 border-amber-500/20 text-amber-500"
  };
};

export const getClassificationLabel = (classification?: string, fallback?: string, t?: any) => {
  if (classification === "person" || classification === "human") return t ? t("humanLabel") : "Deteksi Manusia";
  if (classification === "sound") return t ? t("sound") : "Deteksi Suara";
  if (classification && ["cat", "dog", "bird", "horse", "sheep", "cow", "pet"].includes(classification)) return t ? t("petLabel") : "Deteksi Hewan";
  if (classification && ["car", "motorcycle", "bus", "truck", "bicycle", "vehicle"].includes(classification)) return t ? t("vehicleLabel") : "Deteksi Kendaraan";
  if (classification === "pixel" || classification === "motion") return t ? t("pixelLabel") : "Gerakan (Pixel)";
  return fallback || classification || (t ? t("motionLabel") : "Deteksi Gerakan");
};

export function EventList() {
  const { t, lang } = useTranslation();
  const {
    selectedCameraIds, selectedDate, setSelectedDate, playbackInfoMap,
    eventsMap, searchKeyword, minScore, filterStartTime, filterEndTime,
    setActivePosterUrl, setActiveSnapshot, setJumpToTimeTrigger
  } = usePlayback();

  const events = useMemo(() => {
    let allEvents: SmartEvent[] = [];
    selectedCameraIds.forEach(id => {
       if (eventsMap[id]) allEvents = allEvents.concat(eventsMap[id]);
    });
    return allEvents;
  }, [eventsMap, selectedCameraIds]);

  const filteredEvents = useMemo(() => {
    return events.filter((evt) => {
      const keyword = searchKeyword.toLowerCase();
      const label = getClassificationLabel(evt.type, evt.typeDescription, t).toLowerCase();
      const matchKeyword = !searchKeyword || label.includes(keyword) || evt.id.toLowerCase().includes(keyword);

      const matchScore = (evt.score || 0) >= minScore;

      const dateObj = new Date(evt.ts);
      const hours = dateObj.getHours();
      const minutes = dateObj.getMinutes();
      const evtMinutes = hours * 60 + minutes;

      const [startH, startM] = filterStartTime.split(":").map(Number);
      const [endH, endM] = filterEndTime.split(":").map(Number);
      const startMinutes = (startH || 0) * 60 + (startM || 0);
      const endMinutes = (endH || 23) * 60 + (endM || 59);
      const matchTime = evtMinutes >= startMinutes && evtMinutes <= endMinutes;

      return matchKeyword && matchScore && matchTime;
    });
  }, [events, searchKeyword, minScore, filterStartTime, filterEndTime, t]);

  const groupedEvents = useMemo(() => {
    if (!filteredEvents || filteredEvents.length === 0) return [];
    const groups: { [hour: string]: SmartEvent[] } = {};
    filteredEvents.forEach((evt) => {
      const date = new Date(evt.ts);
      const hourStr = `${String(date.getHours()).padStart(2, "0")}:00`;
      if (!groups[hourStr]) groups[hourStr] = [];
      groups[hourStr].push(evt);
    });

    return Object.keys(groups)
      .sort((a, b) => b.localeCompare(a))
      .map((hour) => ({
        hour,
        events: groups[hour].sort((e1, e2) => new Date(e2.ts).getTime() - new Date(e1.ts).getTime()),
      }));
  }, [filteredEvents]);

  const formatEventTime = (ts: string | number) => {
    try {
      return new Date(ts).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", hour12: false });
    } catch {
      return "--:--";
    }
  };

  const handleEventClick = (evt: SmartEvent) => {
    setActivePosterUrl(eventApi.snapshotUrl(evt.id));
    // Jump 3s before event
    const eventTime = Math.floor(new Date(evt.ts).getTime() / 1000) - 3;
    setJumpToTimeTrigger(eventTime);
  };

  if (selectedCameraIds.length === 0) {
    return (
      <Card className="border border-border/40 flex flex-col min-h-[300px] bg-card h-full">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/10 sticky top-0 bg-card z-10 shadow-sm">
          <h3 className="font-semibold text-sm text-foreground">
            {lang === "id" ? "Kejadian Terbaru (Semua Kamera)" : "Recent Events (All Cameras)"}
          </h3>
          <span className="text-[10px] text-muted-foreground bg-muted dark:bg-slate-900 border border-border/40 px-1.5 py-0.5 rounded font-mono">
            {filteredEvents.length} {lang === "id" ? "Event" : "Events"}
          </span>
        </div>

        <div className="p-5 flex-1 overflow-y-auto space-y-4 max-h-[calc(100vh-160px)] scrollbar-thin">
          {filteredEvents.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-12">
              {lang === "id" ? "Tidak ada event terbaru" : "No recent events"}
            </div>
          ) : (
            <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-2 xl:grid-cols-2 gap-3">
              {filteredEvents.slice(0, 50).map((evt) => {
                const badge = getClassificationBadge(evt.type, t);
                const eventDate = new Date(evt.ts);
                const timeStr = eventDate.toLocaleTimeString(lang === "id" ? "id-ID" : "en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
                const dateStr = eventDate.toLocaleDateString(lang === "id" ? "id-ID" : "en-US", { month: "short", day: "numeric" });
                
                return (
                  <div
                    key={evt.id}
                    className="group relative z-0 aspect-video rounded-lg overflow-hidden border border-border/40 hover:border-primary/50 bg-muted/20 cursor-pointer shadow-sm transition-all duration-300 w-full"
                    onClick={() => {
                      const localDate = new Date(evt.ts).toLocaleDateString("sv-SE");
                      setSelectedDate(localDate);
                      setActivePosterUrl(eventApi.snapshotUrl(evt.id));
                      setSelectedCameraId(evt.cameraId);
                      
                      const eventTime = Math.floor(new Date(evt.ts).getTime() / 1000) - 3;
                      setJumpToTimeTrigger(eventTime);
                    }}
                  >
                    <img
                      src={eventApi.snapshotUrl(evt.id)}
                      alt={evt.type}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      loading="lazy"
                      onError={(e) => { (e.target as HTMLElement).style.display = "none"; }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                    
                    <div className="absolute top-1.5 left-1.5 text-[8px] bg-black/75 px-1 py-0.5 rounded border border-white/5 font-semibold text-white/90 truncate max-w-[85%]">
                      {evt.cameraName}
                    </div>

                    <span className="absolute bottom-1.5 right-1.5 px-1 py-0.5 rounded text-[8px] font-mono font-bold bg-black/75 text-white/90 border border-white/5 leading-none">
                      {dateStr} {timeStr}
                    </span>
                    
                    <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1">
                      <span className={cn("px-1 py-0.5 rounded text-[8px] border font-semibold flex items-center gap-0.5", badge.bgColor)}>
                        {badge.icon}
                        <span>{badge.label}</span>
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>
    );
  }

  if (selectedCameraIds.length === 0 || Object.keys(playbackInfoMap).length === 0) return null;

  return (
    <Card className="border border-border/40 flex flex-col min-h-[300px] bg-card">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border/10 sticky top-0 bg-card z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <Button
            variant="outline" size="icon"
            className="h-7 w-7 rounded-md border-border/40 hover:bg-muted"
            onClick={() => {
              const d = new Date(selectedDate);
              d.setDate(d.getDate() - 1);
              setSelectedDate(d.toISOString().split("T")[0]);
              setActivePosterUrl(null);
            }}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-bold tracking-tight font-mono">
            {new Date(selectedDate).toLocaleDateString(lang === "id" ? "id-ID" : "en-US", { month: "2-digit", day: "2-digit" })}
          </span>
          <Button
            variant="outline" size="icon"
            className="h-7 w-7 rounded-md border-border/40 hover:bg-muted"
            onClick={() => {
              const d = new Date(selectedDate);
              d.setDate(d.getDate() + 1);
              setSelectedDate(d.toISOString().split("T")[0]);
              setActivePosterUrl(null);
            }}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <h3 className="font-semibold text-xs text-muted-foreground ml-2">
            {lang === "id" ? "Daftar Event Deteksi" : "Detection Events List"}
          </h3>
        </div>

        <span className="text-[10px] text-muted-foreground bg-muted dark:bg-slate-900 border border-border/40 px-1.5 py-0.5 rounded font-mono">
          {events.length} {lang === "id" ? "Event" : "Events"}
        </span>
      </div>

      <div className="p-5 space-y-4">
        {groupedEvents.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-12">
            {lang === "id" ? "Tidak ada event deteksi untuk tanggal ini" : "No detection events for this date"}
          </div>
        ) : (
          groupedEvents.map((group) => (
            <div key={group.hour} className="space-y-2">
              <div className="text-xs font-bold text-muted-foreground font-mono py-1 mb-2">
                {group.hour}
              </div>
              <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-2 xl:grid-cols-2 gap-3">
                {group.events.map((evt) => {
                  const badge = getClassificationBadge(evt.type, t);
                  return (
                    <div
                      key={evt.id}
                      className="group relative z-0 aspect-video rounded-lg overflow-hidden border border-border/40 hover:border-primary/50 bg-muted/20 cursor-pointer shadow-sm transition-all duration-300 w-full"
                      onClick={() => handleEventClick(evt)}
                    >
                      <img
                        src={eventApi.snapshotUrl(evt.id)}
                        alt={evt.type}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        loading="lazy"
                        onError={(e) => { (e.target as HTMLElement).style.display = "none"; }}
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                      
                      <span className="absolute bottom-1.5 right-1.5 px-1 py-0.5 rounded text-[8px] font-mono font-bold bg-black/75 text-white/90 border border-white/5 leading-none">
                        {formatEventTime(evt.ts)}
                      </span>

                      <span className={cn(
                        "absolute top-1.5 left-1.5 h-5 w-5 rounded-full text-[10px] flex items-center justify-center backdrop-blur-md shadow-md border border-white/10",
                        badge.bgColor
                      )} title={getClassificationLabel(evt.type, evt.typeDescription, t)}>
                        {badge.icon}
                      </span>

                      {evt.score !== undefined && evt.score !== null && (
                        <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[8px] font-mono font-bold bg-black/75 text-emerald-400 backdrop-blur-sm leading-none border border-white/5 shadow-md">
                          ⚡ {evt.score}%
                        </span>
                      )}

                      <button
                        type="button"
                        className="absolute bottom-1.5 left-1.5 p-1 rounded bg-black/75 hover:bg-black text-white border border-white/10 shadow-lg z-10 cursor-pointer transition-colors block md:hidden"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveSnapshot(evt.id);
                        }}
                        title="Lihat Snapshot"
                      >
                        <Eye className="h-3 w-3" />
                      </button>

                      <div 
                        className="absolute inset-0 bg-black/80 backdrop-blur-[1.5px] opacity-0 group-hover:opacity-100 hidden md:flex items-center justify-center gap-3 transition-all duration-300 z-10"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEventClick(evt);
                        }}
                      >
                        <Button
                          size="icon" variant="secondary"
                          className="h-8 w-8 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 text-white backdrop-blur-md"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveSnapshot(evt.id);
                          }}
                          title="Tampilkan Snapshot"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon" className="h-8 w-8 rounded-full"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEventClick(evt);
                          }}
                          title="Putar Rekaman"
                        >
                          <Play className="h-4 w-4 fill-current" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
