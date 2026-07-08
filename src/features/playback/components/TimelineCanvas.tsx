import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { usePlayback } from "../context/PlaybackContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Info, PlayCircle } from "lucide-react";

export function TimelineCanvas() {
  const { t } = useTranslation();
  const {
    selectedDate, playbackInfo, events,
    timelineZoom, setTimelineZoom,
    timelineCenterTs, setTimelineCenterTs,
    currentPlaybackTs, setCurrentPlaybackTs,
    currentRecordingTime, setCurrentRecordingTime,
    preciseTimeInput, setPreciseTimeInput,
    playbackWindowMinutes, setPlaybackWindowCenterTs,
    setJumpToTimeTrigger, setActivePosterUrl
  } = usePlayback();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartCenter, setDragStartCenter] = useState<number | null>(null);
  const dragStartPlayheadRef = useRef<number | null>(null);

  const [hoverInfo, setHoverInfo] = useState<{ x: number; time: number; show: boolean }>({ x: 0, time: 0, show: false });

  // Draw timeline canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !playbackInfo) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    ctx.fillStyle = "#020617";
    ctx.fillRect(0, 0, width, height);

    const startOfDay = new Date(`${selectedDate}T00:00:00`);
    const endOfDay = new Date(`${selectedDate}T23:59:59.999`);
    const startUnix = Math.floor(startOfDay.getTime() / 1000);
    const endUnix = Math.floor(endOfDay.getTime() / 1000);

    const windowSizes = {
      "24h": 86400, "6h": 6 * 3600, "1h": 3600,
      "15m": 15 * 60, "5m": 5 * 60, "1m": 60,
    };
    const size = windowSizes[timelineZoom];
    
    const current = currentPlaybackTs || startUnix;
    const center = timelineCenterTs !== null ? timelineCenterTs : current;

    let zoomStart = center - size / 2;
    let zoomEnd = center + size / 2;
    if (zoomStart < startUnix) {
      zoomStart = startUnix;
      zoomEnd = Math.min(endUnix, startUnix + size);
    }
    if (zoomEnd > endUnix) {
      zoomEnd = endUnix;
      zoomStart = Math.max(startUnix, endUnix - size);
    }

    const timeSpan = zoomEnd - zoomStart;

    // Draw segment blocks
    const mappings = playbackInfo.segmentMappings || [];
    ctx.fillStyle = "rgba(16, 185, 129, 0.4)";
    for (const seg of mappings) {
      if (seg.ts + seg.duration >= zoomStart && seg.ts <= zoomEnd) {
        const x = ((seg.ts - zoomStart) / timeSpan) * width;
        const w = (seg.duration / timeSpan) * width;
        ctx.fillRect(x, 0, Math.max(1, w), height - 16);
      }
    }

    // Draw ticks
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
    ctx.font = "9px monospace";
    ctx.textAlign = "center";

    let tickSpacing = 3600;
    if (timelineZoom === "6h") tickSpacing = 1800;
    else if (timelineZoom === "1h") tickSpacing = 600;
    else if (timelineZoom === "15m") tickSpacing = 60;
    else if (timelineZoom === "5m") tickSpacing = 30;
    else if (timelineZoom === "1m") tickSpacing = 5;

    const firstTick = Math.ceil(zoomStart / tickSpacing) * tickSpacing;
    for (let t = firstTick; t <= zoomEnd; t += tickSpacing) {
      const x = ((t - zoomStart) / timeSpan) * width;
      ctx.beginPath();
      ctx.moveTo(x, height - 16);
      ctx.lineTo(x, height - 10);
      ctx.stroke();

      const d = new Date(t * 1000);
      const hStr = String(d.getHours()).padStart(2, "0");
      const mStr = String(d.getMinutes()).padStart(2, "0");
      const sStr = String(d.getSeconds()).padStart(2, "0");
      const label = timelineZoom === "1m" || timelineZoom === "5m" 
        ? `${hStr}:${mStr}:${sStr}` 
        : `${hStr}:${mStr}`;
      ctx.fillText(label, x, height - 3);
    }

    // Draw Event Ticks
    for (const evt of events) {
      const evtUnix = Math.floor(new Date(evt.ts).getTime() / 1000);
      if (evtUnix >= zoomStart && evtUnix <= zoomEnd) {
        const x = ((evtUnix - zoomStart) / timeSpan) * width;
        let color = "#64748b";
        if (evt.type === "person" || evt.type === "human") color = "#f43f5e";
        else if (["cat", "dog", "bird", "horse", "sheep", "cow", "pet"].includes(evt.type)) color = "#10b981";
        else if (evt.type === "sound") color = "#06b6d4";
        else if (["car", "motorcycle", "bus", "truck", "bicycle", "vehicle"].includes(evt.type)) color = "#3b82f6";
        else if (evt.type === "motion" || evt.type === "pixel") color = "#f59e0b";
        
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") {
          ctx.roundRect(x - 3, 2, 6, height - 20, 3);
        } else {
          ctx.rect(x - 3, 2, 6, height - 20);
        }
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }

    // Draw Playhead
    if (currentPlaybackTs && currentPlaybackTs >= zoomStart && currentPlaybackTs <= zoomEnd) {
      const x = ((currentPlaybackTs - zoomStart) / timeSpan) * width;
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height - 16);
      ctx.stroke();

      ctx.fillStyle = "#fbbf24";
      ctx.beginPath();
      ctx.moveTo(x - 5, 0);
      ctx.lineTo(x + 5, 0);
      ctx.lineTo(x, 6);
      ctx.fill();
    }
  }, [playbackInfo, events, selectedDate, timelineZoom, currentPlaybackTs, timelineCenterTs]);

  const getUnixFromX = (x: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const width = canvas.getBoundingClientRect().width;

    const startOfDay = new Date(`${selectedDate}T00:00:00`);
    const endOfDay = new Date(`${selectedDate}T23:59:59.999`);
    const startUnix = Math.floor(startOfDay.getTime() / 1000);
    const endUnix = Math.floor(endOfDay.getTime() / 1000);

    const windowSizes = { "24h": 86400, "6h": 6 * 3600, "1h": 3600, "15m": 15 * 60, "5m": 5 * 60, "1m": 60 };
    const size = windowSizes[timelineZoom];
    const current = currentPlaybackTs || startUnix;
    const center = timelineCenterTs !== null ? timelineCenterTs : current;

    let zoomStart = center - size / 2;
    let zoomEnd = center + size / 2;
    if (zoomStart < startUnix) { zoomStart = startUnix; zoomEnd = Math.min(endUnix, startUnix + size); }
    if (zoomEnd > endUnix) { zoomEnd = endUnix; zoomStart = Math.max(startUnix, endUnix - size); }

    const timeSpan = zoomEnd - zoomStart;
    return zoomStart + (x / width) * timeSpan;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !playbackInfo) return;
    canvas.setPointerCapture(e.pointerId);

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickUnix = getUnixFromX(clickX);

    if (e.shiftKey) {
      setIsPanning(true);
      setDragStartX(e.clientX);
      const current = currentPlaybackTs || clickUnix;
      setDragStartCenter(timelineCenterTs !== null ? timelineCenterTs : current);
    } else {
      setIsScrubbing(true);
      setActivePosterUrl(null);
      setDragStartX(e.clientX);
      dragStartPlayheadRef.current = clickUnix;
      setCurrentPlaybackTs(clickUnix);
      setCurrentRecordingTime(new Date(clickUnix * 1000).toLocaleTimeString("id-ID", { hour12: false }));
      setJumpToTimeTrigger(clickUnix);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !playbackInfo) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const currentUnix = getUnixFromX(mouseX);

    setHoverInfo({ x: mouseX, time: currentUnix, show: true });

    if (isScrubbing) {
      const startOfDay = new Date(`${selectedDate}T00:00:00`);
      const endOfDay = new Date(`${selectedDate}T23:59:59.999`);
      const startUnix = Math.floor(startOfDay.getTime() / 1000);
      const endUnix = Math.floor(endOfDay.getTime() / 1000);

      const windowSizes = { "24h": 86400, "6h": 6 * 3600, "1h": 3600, "15m": 15 * 60, "5m": 5 * 60, "1m": 60 };
      const size = windowSizes[timelineZoom];
      const current = currentPlaybackTs || startUnix;
      const center = timelineCenterTs !== null ? timelineCenterTs : current;
      let zoomStart = center - size / 2;
      let zoomEnd = center + size / 2;
      if (zoomStart < startUnix) { zoomStart = startUnix; zoomEnd = Math.min(endUnix, startUnix + size); }
      if (zoomEnd > endUnix) { zoomEnd = endUnix; zoomStart = Math.max(startUnix, endUnix - size); }
      
      const timeSpan = zoomEnd - zoomStart;
      const sensitivities = { "24h": 0.05, "6h": 0.15, "1h": 0.35, "15m": 0.7, "5m": 1.0, "1m": 1.0 };
      const sensitivity = sensitivities[timelineZoom] || 1.0;
      const deltaX = e.clientX - dragStartX;
      const timeDelta = (deltaX / rect.width) * timeSpan * sensitivity;
      const startPlayhead = dragStartPlayheadRef.current !== null ? dragStartPlayheadRef.current : currentUnix;
      const scrubUnix = Math.max(startUnix, Math.min(endUnix, startPlayhead + timeDelta));

      setCurrentPlaybackTs(scrubUnix);
      setCurrentRecordingTime(new Date(scrubUnix * 1000).toLocaleTimeString("id-ID", { hour12: false }));
      setJumpToTimeTrigger(scrubUnix);
    } else if (isPanning && dragStartCenter !== null) {
      const width = rect.width;
      const windowSizes = { "24h": 86400, "6h": 6 * 3600, "1h": 3600, "15m": 15 * 60, "5m": 5 * 60, "1m": 60 };
      const size = windowSizes[timelineZoom];
      const deltaX = e.clientX - dragStartX;
      const timeDelta = -(deltaX / width) * size;
      setTimelineCenterTs(dragStartCenter + timeDelta);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (canvas) canvas.releasePointerCapture(e.pointerId);
    setIsScrubbing(false);
    setIsPanning(false);
    setDragStartCenter(null);
    dragStartPlayheadRef.current = null;
    setHoverInfo((prev) => ({ ...prev, show: false }));
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const direction = e.deltaY < 0 ? -1 : 1;
    let shiftSecs = 10;
    if (timelineZoom === "24h") shiftSecs = 120;
    else if (timelineZoom === "6h") shiftSecs = 30;
    else if (timelineZoom === "1h") shiftSecs = 10;
    else if (timelineZoom === "15m") shiftSecs = 5;
    else if (timelineZoom === "5m") shiftSecs = 2;
    else shiftSecs = 1;

    setJumpToTimeTrigger((currentPlaybackTs || 0) + (direction * shiftSecs));
  };

  const jumpToPreciseTime = () => {
    if (!playbackInfo) return;
    const parts = preciseTimeInput.split(":");
    if (parts.length < 2) return;
    const hours = parts[0];
    const minutes = parts[1];
    const seconds = parts[2] || "00";
    const targetTimeStr = `${selectedDate}T${hours.padStart(2, "0")}:${minutes.padStart(2, "0")}:${seconds.padStart(2, "0")}`;
    const targetUnix = Math.floor(new Date(targetTimeStr).getTime() / 1000);
    if (isNaN(targetUnix)) return;

    if (playbackWindowMinutes !== "none") {
      setPlaybackWindowCenterTs(targetUnix);
      return;
    }
    setJumpToTimeTrigger(targetUnix);
  };

  return (
    <>
      {playbackInfo?.hasRecording && (
        <Card className="p-4 border border-border/40 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <PlayCircle className="h-4 w-4 text-primary animate-pulse" />
              <span className="text-xs font-semibold text-foreground">{t("recordingTime")}:</span>
              <span className="text-xs font-mono bg-primary/10 border border-primary/20 text-primary px-2.5 py-1 rounded">
                {currentRecordingTime || "--:--:--"}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground font-medium">{t("zoomScale")}:</span>
              {["24h", "6h", "1h", "15m", "5m", "1m"].map((z) => (
                <Button
                  key={z}
                  size="sm"
                  variant={timelineZoom === z ? "default" : "outline"}
                  className="h-7 px-2 text-xs font-semibold"
                  onClick={() => {
                    setTimelineZoom(z as any);
                    setTimelineCenterTs(null);
                  }}
                >
                  {z === "24h" ? t("zoom24h") : z === "6h" ? t("zoom6h") : z === "1h" ? t("zoom1h") : z}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 pt-3 border-t border-border/10">
            <div className="flex items-center gap-2">
              <Label className="text-xs font-semibold text-muted-foreground whitespace-nowrap">{t("jumpSpecific")}:</Label>
              <input
                type="text"
                placeholder="12:00:00"
                value={preciseTimeInput}
                onChange={(e) => setPreciseTimeInput(e.target.value.replace(/[^0-9:]/g, ""))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") jumpToPreciseTime();
                }}
                className="w-24 px-2.5 py-1.5 rounded-md border border-border/60 bg-background text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <Button size="sm" onClick={jumpToPreciseTime} className="h-8">
                {t("jumpBtn")}
              </Button>
            </div>
            <div className="text-[10px] text-muted-foreground ml-auto max-w-sm hidden sm:block">
              <Info className="h-3 w-3 inline-block mr-1 -mt-0.5" />
              {t("timelineHelp")}
            </div>
          </div>

          <div 
            className="w-full h-16 bg-slate-900 border-y border-white/5 relative overflow-hidden select-none touch-none rounded"
            title={t("dragTimelineScroll")}
          >
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full cursor-crosshair"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              onWheel={handleWheel}
            />
            {hoverInfo.show && (
              <div 
                className="absolute top-1 pointer-events-none bg-black/80 backdrop-blur-md text-white text-[10px] font-mono px-2 py-1 rounded shadow-lg border border-white/10 whitespace-nowrap z-10 transform -translate-x-1/2"
                style={{ left: Math.max(20, Math.min(hoverInfo.x, canvasRef.current?.getBoundingClientRect().width! - 20)) }}
              >
                {new Date(hoverInfo.time * 1000).toLocaleTimeString("id-ID", { hour12: false })}
              </div>
            )}
          </div>
        </Card>
      )}
    </>
  );
}
