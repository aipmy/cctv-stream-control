import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { usePlayback } from "../context/PlaybackContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Info, PlayCircle, ZoomIn, ZoomOut } from "lucide-react";

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
  const [dragStartY, setDragStartY] = useState(0);
  const [dragStartCenter, setDragStartCenter] = useState<number | null>(null);
  const dragStartPlayheadRef = useRef<number | null>(null);

  const [hoverInfo, setHoverInfo] = useState<{ y: number; time: number; show: boolean }>({ y: 0, time: 0, show: false });

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

    ctx.fillStyle = "#020817"; // ultra dark slate
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

    // Draw segment blocks (Subtle blue background + blue edge for recordings)
    const mappings = playbackInfo.segmentMappings || [];
    for (const seg of mappings) {
      if (seg.ts + seg.duration >= zoomStart && seg.ts <= zoomEnd) {
        const y = ((seg.ts - zoomStart) / timeSpan) * height;
        const h = Math.max(2, (seg.duration / timeSpan) * height);
        // Subtle background
        ctx.fillStyle = "rgba(59, 130, 246, 0.12)"; 
        ctx.fillRect(0, y, width, h);
        // Bright edge line
        ctx.fillStyle = "rgba(59, 130, 246, 0.8)";
        ctx.fillRect(width - 3, y, 3, h);
      }
    }
    
    if (mappings.length === 0 || events.length === 0) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (mappings.length === 0) ctx.fillText("No Recordings API", width / 2, (height / 2) - 10);
      if (events.length === 0) ctx.fillText("0 Events Found", width / 2, (height / 2) + 10);
    }

    // Draw ticks (Left aligned)
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
    ctx.font = "9px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    let tickSpacing = 3600;
    if (timelineZoom === "6h") tickSpacing = 1800;
    else if (timelineZoom === "1h") tickSpacing = 600;
    else if (timelineZoom === "15m") tickSpacing = 60;
    else if (timelineZoom === "5m") tickSpacing = 30;
    else if (timelineZoom === "1m") tickSpacing = 5;

    const firstTick = Math.ceil(zoomStart / tickSpacing) * tickSpacing;
    for (let t = firstTick; t <= zoomEnd; t += tickSpacing) {
      const y = ((t - zoomStart) / timeSpan) * height;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(6, y);
      ctx.stroke();

      const d = new Date(t * 1000);
      const hStr = String(d.getHours()).padStart(2, "0");
      const mStr = String(d.getMinutes()).padStart(2, "0");
      const sStr = String(d.getSeconds()).padStart(2, "0");
      const label = timelineZoom === "1m" || timelineZoom === "5m" 
        ? `${hStr}:${mStr}:${sStr}` 
        : `${hStr}:${mStr}`;
      ctx.fillText(label, 10, y);
    }

    // Draw Event Ticks (Sleek Horizontal Lines)
    for (const evt of events) {
      const evtUnix = Math.floor(new Date(evt.ts).getTime() / 1000);
      if (evtUnix >= zoomStart && evtUnix <= zoomEnd) {
        const y = ((evtUnix - zoomStart) / timeSpan) * height;
        let color = "#fbbf24"; // amber for motion
        if (evt.type === "person" || evt.type === "human") color = "#f43f5e";
        else if (["cat", "dog", "bird", "horse", "sheep", "cow", "pet"].includes(evt.type)) color = "#10b981";
        else if (evt.type === "sound") color = "#06b6d4";
        else if (["car", "motorcycle", "bus", "truck", "bicycle", "vehicle"].includes(evt.type)) color = "#3b82f6";
        
        ctx.fillStyle = color;
        ctx.fillRect(0, y - 1, width - 3, 2);
      }
    }

    // Draw Playhead (Sleek Red Line & Pill)
    if (currentPlaybackTs && currentPlaybackTs >= zoomStart && currentPlaybackTs <= zoomEnd) {
      const y = ((currentPlaybackTs - zoomStart) / timeSpan) * height;
      
      ctx.strokeStyle = "#ef4444"; // sleek red
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      const timeStr = new Date(currentPlaybackTs * 1000).toLocaleTimeString("id-ID", { hour12: false });
      ctx.font = "bold 9px sans-serif";
      const textWidth = ctx.measureText(timeStr).width;
      const pillWidth = textWidth + 12;
      const pillHeight = 16;
      
      ctx.fillStyle = "#ef4444"; 
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect((width / 2) - (pillWidth / 2), y - (pillHeight / 2), pillWidth, pillHeight, 8);
      } else {
        ctx.rect((width / 2) - (pillWidth / 2), y - (pillHeight / 2), pillWidth, pillHeight);
      }
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(timeStr, width / 2, y + 0.5);
    }
  }, [playbackInfo, events, selectedDate, timelineZoom, currentPlaybackTs, timelineCenterTs]);

  const getUnixFromY = (y: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const height = canvas.getBoundingClientRect().height;

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
    return zoomStart + (y / height) * timeSpan;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !playbackInfo) return;
    canvas.setPointerCapture(e.pointerId);

    const rect = canvas.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const clickUnix = getUnixFromY(clickY);

    if (e.shiftKey) {
      setIsPanning(true);
      setDragStartY(e.clientY);
      const current = currentPlaybackTs || clickUnix;
      setDragStartCenter(timelineCenterTs !== null ? timelineCenterTs : current);
    } else {
      setIsScrubbing(true);
      setActivePosterUrl(null);
      setDragStartY(e.clientY);
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
    const mouseY = e.clientY - rect.top;
    const currentUnix = getUnixFromY(mouseY);

    setHoverInfo({ y: mouseY, time: currentUnix, show: true });

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
      const deltaY = e.clientY - dragStartY;
      const timeDelta = (deltaY / rect.height) * timeSpan * sensitivity;
      const startPlayhead = dragStartPlayheadRef.current !== null ? dragStartPlayheadRef.current : currentUnix;
      const scrubUnix = Math.max(startUnix, Math.min(endUnix, startPlayhead + timeDelta));

      setCurrentPlaybackTs(scrubUnix);
      setCurrentRecordingTime(new Date(scrubUnix * 1000).toLocaleTimeString("id-ID", { hour12: false }));
      setJumpToTimeTrigger(scrubUnix);
    } else if (isPanning && dragStartCenter !== null) {
      const height = rect.height;
      const windowSizes = { "24h": 86400, "6h": 6 * 3600, "1h": 3600, "15m": 15 * 60, "5m": 5 * 60, "1m": 60 };
      const size = windowSizes[timelineZoom];
      const deltaY = e.clientY - dragStartY;
      const timeDelta = -(deltaY / height) * size;
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

  const zoomLevels = ["24h", "6h", "1h", "15m", "5m", "1m"];
  const handleZoomIn = () => {
    const idx = zoomLevels.indexOf(timelineZoom);
    if (idx < zoomLevels.length - 1) {
      setTimelineZoom(zoomLevels[idx + 1] as any);
      setTimelineCenterTs(null);
    }
  };
  const handleZoomOut = () => {
    const idx = zoomLevels.indexOf(timelineZoom);
    if (idx > 0) {
      setTimelineZoom(zoomLevels[idx - 1] as any);
      setTimelineCenterTs(null);
    }
  };

  return (
    <>
      {playbackInfo?.hasRecording && (
        <div 
          className="w-full h-full bg-[#111111] border-l border-border/40 relative overflow-hidden select-none touch-none shadow-xl"
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

          {/* Floating Zoom Controls at Top Right */}
          <div className="absolute top-2 right-1.5 flex flex-col items-center justify-center gap-1.5 z-10 bg-slate-900/80 backdrop-blur-md p-1 rounded-full border border-white/10 shadow-lg">
            <button
              onClick={handleZoomIn}
              className="p-1 hover:bg-white/10 rounded-full transition-colors group"
              title="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5 text-white/70 group-hover:text-white" />
            </button>
            <div className="w-3 h-px bg-white/20" />
            <button
              onClick={handleZoomOut}
              className="p-1 hover:bg-white/10 rounded-full transition-colors group"
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5 text-white/70 group-hover:text-white" />
            </button>
          </div>

          {hoverInfo.show && (
            <div 
              className="absolute left-2 pointer-events-none bg-black/90 backdrop-blur-md text-primary font-mono px-2 py-1 rounded shadow-lg border border-primary/20 text-[10px] whitespace-nowrap z-20 transform -translate-y-1/2"
              style={{ top: Math.max(20, Math.min(hoverInfo.y, canvasRef.current?.getBoundingClientRect().height! - 20)) }}
            >
              {new Date(hoverInfo.time * 1000).toLocaleTimeString("id-ID", { hour12: false })}
            </div>
          )}
        </div>
      )}
    </>
  );
}
