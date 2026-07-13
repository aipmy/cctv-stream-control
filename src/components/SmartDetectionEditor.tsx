import React, { useEffect, useMemo, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MotionArea } from "@/types";

export function SmartDetectionEditor({
  cameraId,
  cameraEnabled,
  value,
  onChange,
  showPixelMotion = true,
  showPerson = true,
  showPet = true,
  showObject = true,
  aiSensitivity = 50,
  motionSensitivityValue = 10,
  enableSoundDetection = false,
  onShowPersonChange,
  onShowPetChange,
  onShowObjectChange,
  onShowPixelMotionChange,
  onAiSensitivityChange,
  onMotionSensitivityChange,
  onEnableSoundDetectionChange,
}: {
  cameraId: string;
  cameraEnabled: boolean;
  value: MotionArea[];
  onChange: (areas: MotionArea[]) => void;
  showPixelMotion?: boolean;
  showPerson?: boolean;
  showPet?: boolean;
  showObject?: boolean;
  aiSensitivity?: number;
  motionSensitivityValue?: number;
  enableSoundDetection?: boolean;
  onShowPersonChange?: (v: boolean) => void;
  onShowPetChange?: (v: boolean) => void;
  onShowObjectChange?: (v: boolean) => void;
  onShowPixelMotionChange?: (v: boolean) => void;
  onAiSensitivityChange?: (v: number) => void;
  onMotionSensitivityChange?: (v: number) => void;
  onEnableSoundDetectionChange?: (v: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [connected, setConnected] = useState(false);
  const [activity, setActivity] = useState(0);
  const [mode, setMode] = useState<"none" | "exclude_poly" | "exclude_rect" | "intrusion_poly" | "tripwire">("none");
  const [isDrawingRect, setIsDrawingRect] = useState(false);
  const [rectStart, setRectStart] = useState({ x: 0, y: 0 });
  const [rectCurrent, setRectCurrent] = useState({ x: 0, y: 0 });
  const [polyPoints, setPolyPoints] = useState<{ x: number; y: number }[]>([]);
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null);
  const [isHoveringZone, setIsHoveringZone] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [isMotionDetected, setIsMotionDetected] = useState(false);
  const [detectionCount, setDetectionCount] = useState(0);
  const [currentFps, setCurrentFps] = useState(0);

  const boxesRef = useRef<Array<{ x: number; y: number; w: number; h: number; blocks?: number }>>([]);
  const aiBoxesRef = useRef<Array<{ class: string; score: number; bbox: number[]; frameWidth: number; frameHeight: number }>>([]);
  const frameDims = useRef({ width: 640, height: 480 });
  const frameCountRef = useRef(0);
  const lastFpsTimeRef = useRef(Date.now());

  // ──── Smooth Interpolation System ────
  // Each tracked object has current/target positions + opacity for smooth rendering
  interface TrackedBox {
    id: string;          // Stable ID for tracking
    cls: string;         // Detection class
    score: number;       // Confidence score
    // Current interpolated position (what we draw)
    cx: number; cy: number; cw: number; ch: number;
    // Target position (from latest AI frame)
    tx: number; ty: number; tw: number; th: number;
    frameWidth: number; frameHeight: number;
    opacity: number;     // 0..1, for fade in/out
    lastSeen: number;    // timestamp of last AI update
    isNew: boolean;      // true on first frame (for fade-in)
  }
  const trackedBoxesRef = useRef<TrackedBox[]>([]);
  const aiUpdateTsRef = useRef(0);

  // Refs for filter state (avoid re-creating draw loop on every toggle)
  const showPersonRef = useRef(showPerson);
  const showPetRef = useRef(showPet);
  const showObjectRef = useRef(showObject);
  const showPixelMotionRef = useRef(showPixelMotion);
  const aiSensitivityRef = useRef(aiSensitivity);
  useEffect(() => { showPersonRef.current = showPerson; }, [showPerson]);
  useEffect(() => { showPetRef.current = showPet; }, [showPet]);
  useEffect(() => { showObjectRef.current = showObject; }, [showObject]);
  useEffect(() => { showPixelMotionRef.current = showPixelMotion; }, [showPixelMotion]);
  useEffect(() => { aiSensitivityRef.current = aiSensitivity; }, [aiSensitivity]);

  // Build MJPEG src URL
  const mjpegSrc = useMemo(() => {
    const token = localStorage.getItem("cctv-lite-token") || "";
    const base = (typeof window !== "undefined" && ["5173", "5174", "8080"].includes(window.location.port))
      ? `${window.location.protocol}//${window.location.hostname}:4200`
      : "";
    return `${base}/api/streams/${cameraId}/video.mjpg?token=${encodeURIComponent(token)}&t=${Date.now()}`;
  }, [cameraId]);

  // Reset image loaded status on stream URL change
  useEffect(() => {
    setImgLoaded(false);
  }, [mjpegSrc]);

  // SSE for motion events
  useEffect(() => {
    if (!cameraId || !cameraEnabled) return;
    const token = localStorage.getItem("cctv-lite-token") || "";
    const base = (typeof window !== "undefined" && ["5173", "5174", "8080"].includes(window.location.port))
      ? `${window.location.protocol}//${window.location.hostname}:4200`
      : "";
    const url = `${base}/api/streams/${cameraId}/events?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    es.onopen = () => setConnected(true);
    es.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        if (data.connected) return;

        // FPS calculation
        frameCountRef.current++;
        const now = Date.now();
        if (now - lastFpsTimeRef.current >= 1000) {
          setCurrentFps(Math.round((frameCountRef.current * 1000) / (now - lastFpsTimeRef.current)));
          frameCountRef.current = 0;
          lastFpsTimeRef.current = now;
        }

        if (data.type === "ai-motion") {
          if (data.predictions) {
            aiBoxesRef.current = data.predictions;
            aiUpdateTsRef.current = Date.now();
            // Match incoming detections to existing tracked boxes (by class + IoU)
            const now = Date.now();
            const incoming = data.predictions as Array<{ class: string; score: number; bbox: number[]; frameWidth: number; frameHeight: number }>;
            const tracked = trackedBoxesRef.current;
            const matched = new Set<number>(); // indices of tracked that got matched

            for (const det of incoming) {
              const [dx, dy, dw, dh] = det.bbox;
              let bestIdx = -1;
              let bestIoU = 0.15; // minimum IoU to match
              for (let i = 0; i < tracked.length; i++) {
                if (matched.has(i)) continue;
                if (tracked[i].cls !== det.class) continue;
                // Compute IoU between target box and new detection
                const t = tracked[i];
                const x1 = Math.max(dx, t.tx); const y1 = Math.max(dy, t.ty);
                const x2 = Math.min(dx + dw, t.tx + t.tw); const y2 = Math.min(dy + dh, t.ty + t.th);
                const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
                const union = dw * dh + t.tw * t.th - inter;
                const iou = union > 0 ? inter / union : 0;
                if (iou > bestIoU) { bestIoU = iou; bestIdx = i; }
              }
              if (bestIdx >= 0) {
                // Update existing tracked box target
                matched.add(bestIdx);
                tracked[bestIdx].tx = dx; tracked[bestIdx].ty = dy;
                tracked[bestIdx].tw = dw; tracked[bestIdx].th = dh;
                tracked[bestIdx].score = det.score;
                tracked[bestIdx].frameWidth = det.frameWidth;
                tracked[bestIdx].frameHeight = det.frameHeight;
                tracked[bestIdx].lastSeen = now;
                tracked[bestIdx].isNew = false;
              } else {
                // New object — add with fade-in
                tracked.push({
                  id: `${det.class}_${now}_${Math.random().toString(36).slice(2, 6)}`,
                  cls: det.class, score: det.score,
                  cx: dx, cy: dy, cw: dw, ch: dh,
                  tx: dx, ty: dy, tw: dw, th: dh,
                  frameWidth: det.frameWidth, frameHeight: det.frameHeight,
                  opacity: 0, lastSeen: now, isNew: true,
                });
              }
            }
            // Mark unmatched tracked boxes as "lost" (they'll fade out in draw loop)
            trackedBoxesRef.current = tracked;
          }
          return;
        }
        if (data.boxes && data.boxes.length > 0) {
          boxesRef.current = data.boxes;
          if ((window as any)._boxClearTimeout) clearTimeout((window as any)._boxClearTimeout);
          (window as any)._boxClearTimeout = setTimeout(() => { boxesRef.current = []; }, 800);
        }
        if (data.frame) frameDims.current = data.frame;
        if (data.activity != null) setActivity(data.activity);
        if (data.motion != null) setIsMotionDetected(data.motion);
      } catch { /* ignore */ }
    };
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, [cameraId, cameraEnabled]);

  // Canvas overlay draw loop
  useEffect(() => {
    let raf: number;
    const draw = () => {
      const canvas = canvasRef.current;
      const img = imgRef.current;
      if (!canvas || !img) {
        raf = requestAnimationFrame(draw);
        return;
      }

      const rect = img.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);

      if (w === 0 || h === 0) {
        raf = requestAnimationFrame(draw);
        return;
      }

      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        raf = requestAnimationFrame(draw);
        return;
      }

      ctx.clearRect(0, 0, w, h);

      // 1. Draw existing zones
      const activeAreas = value || [];
      activeAreas.forEach((zone, idx) => {
        if (zone.enabled === false) return;
        
        let strokeColor = "rgba(239, 68, 68, 0.95)"; // Exclude (Red)
        let fillColor = "rgba(239, 68, 68, 0.22)";
        let labelColor = "#ff8888";
        let labelText = `MASK ${idx + 1}`;
        
        if (zone.zoneType === "tripwire") {
          strokeColor = "rgba(249, 115, 22, 1)"; // Tripwire (Orange)
          fillColor = "transparent";
          labelColor = "#f97316";
          labelText = `TRIPWIRE ${idx + 1}`;
        } else if (zone.zoneType === "intrusion") {
          strokeColor = "rgba(234, 179, 8, 1)"; // Intrusion (Yellow)
          fillColor = "rgba(234, 179, 8, 0.2)";
          labelColor = "#eab308";
          labelText = `INTRUSION ${idx + 1}`;
        }

        if ((zone.type === "polygon" || zone.type === "line") && zone.points && zone.points.length >= 2) {
          ctx.fillStyle = fillColor;
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = zone.type === "line" ? 3 : 1.5;
          ctx.beginPath();
          ctx.moveTo(zone.points[0].x * w, zone.points[0].y * h);
          for (let i = 1; i < zone.points.length; i++) {
            ctx.lineTo(zone.points[i].x * w, zone.points[i].y * h);
          }
          if (zone.type === "polygon" && zone.points.length >= 3) {
            ctx.closePath();
            ctx.fill();
          }
          ctx.stroke();

          ctx.fillStyle = labelColor;
          ctx.font = "bold 9px monospace";
          ctx.fillText(labelText, zone.points[0].x * w + 5, zone.points[0].y * h + 12);
        } else if (zone.type === "rect" && zone.x != null && zone.y != null && zone.w != null && zone.h != null) {
          ctx.fillStyle = fillColor;
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = 1.5;
          const zx = zone.x * w;
          const zy = zone.y * h;
          const zw = zone.w * w;
          const zh = zone.h * h;
          ctx.fillRect(zx, zy, zw, zh);
          ctx.strokeRect(zx, zy, zw, zh);

          ctx.fillStyle = labelColor;
          ctx.font = "bold 9px monospace";
          ctx.fillText(labelText, zx + 5, zy + 12);
        }
      });

      // 2. Draw in-progress drawing polygon/line
      if (mode.includes("poly") || mode === "tripwire") {
        if (polyPoints.length > 0) {
          const previewPoints = hoverPoint ? [...polyPoints, hoverPoint] : polyPoints;
          ctx.fillStyle = "rgba(251, 191, 36, 0.12)";
          ctx.strokeStyle = "rgba(251, 191, 36, 0.95)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(previewPoints[0].x * w, previewPoints[0].y * h);
          for (let i = 1; i < previewPoints.length; i++) {
            ctx.lineTo(previewPoints[i].x * w, previewPoints[i].y * h);
          }
          
          if (mode.includes("poly") && previewPoints.length >= 3) {
            ctx.closePath();
            ctx.fill();
          }
          ctx.stroke();

        // Draw dots
        ctx.fillStyle = "#fcd34d";
        for (const p of previewPoints) {
          ctx.beginPath();
          ctx.arc(p.x * w, p.y * h, 4, 0, Math.PI * 2);
          ctx.fill();
        }

        // Highlight first point if hover is close
        if (polyPoints.length >= 3 && hoverPoint) {
          const first = polyPoints[0];
          const dx = hoverPoint.x - first.x;
          const dy = hoverPoint.y - first.y;
          if (Math.sqrt(dx * dx + dy * dy) < 0.03) {
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(first.x * w, first.y * h, 7, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        }
      }
      
      // 3. Draw in-progress rectangle (dashed Orange/Yellow)
      if (mode === "rect" && isDrawingRect) {
        ctx.strokeStyle = "rgba(251, 191, 36, 0.9)";
        ctx.fillStyle = "rgba(251, 191, 36, 0.15)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        const rx = Math.min(rectStart.x, rectCurrent.x) * w;
        const ry = Math.min(rectStart.y, rectCurrent.y) * h;
        const rw = Math.abs(rectStart.x - rectCurrent.x) * w;
        const rh = Math.abs(rectStart.y - rectCurrent.y) * h;
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.setLineDash([]);
      }

      // ──── 4. Motion pixel bounding boxes (Green) ────
      if (showPixelMotionRef.current && boxesRef.current.length > 0) {
        const fw = frameDims.current.width || 640;
        const fh = frameDims.current.height || 480;
        const sx = w / fw;
        const sy = h / fh;

        ctx.strokeStyle = "rgba(16, 185, 129, 0.95)";
        ctx.fillStyle = "rgba(16, 185, 129, 0.15)";
        ctx.lineWidth = 3;
        ctx.font = "bold 12px sans-serif";
        for (const box of boxesRef.current) {
          const bx = box.x * sx;
          const by = box.y * sy;
          const bw = box.w * sx;
          const bh = box.h * sy;
          ctx.strokeRect(bx, by, bw, bh);
          ctx.fillRect(bx, by, bw, bh);

          // Label
          const labelText = `motion`;
          const textMetrics = ctx.measureText(labelText);
          const labelW = textMetrics.width + 12;
          ctx.fillStyle = "#10b981";
          ctx.fillRect(bx - 1.5, Math.max(0, by - 22), labelW, 20);
          ctx.fillStyle = "#ffffff";
          ctx.fillText(labelText, bx + 4, Math.max(14, by - 6));
          ctx.fillStyle = "rgba(16, 185, 129, 0.15)";
        }
      }

      // ──── 5. AI bounding boxes — Smooth Interpolation ────
      const aiThreshold = (aiSensitivityRef.current || 50) / 100;
      let filteredCount = 0;
      const now = Date.now();
      const LERP_SPEED = 0.15; // Smoothing factor (0=frozen, 1=instant)
      const FADE_IN_SPEED = 0.15;
      const FADE_OUT_SPEED = 0.025;
      const LOST_TIMEOUT_MS = 3000; // Keep box visible 3s after last detection

      const tracked = trackedBoxesRef.current;

      // Update interpolation + opacity for each tracked box
      for (let i = tracked.length - 1; i >= 0; i--) {
        const t = tracked[i];
        const age = now - t.lastSeen;
        const isLost = age > LOST_TIMEOUT_MS;

        // Remove fully faded boxes
        if (isLost && t.opacity <= 0.01) {
          tracked.splice(i, 1);
          continue;
        }

        // Interpolate position toward target
        t.cx += (t.tx - t.cx) * LERP_SPEED;
        t.cy += (t.ty - t.cy) * LERP_SPEED;
        t.cw += (t.tw - t.cw) * LERP_SPEED;
        t.ch += (t.th - t.ch) * LERP_SPEED;

        // Fade in/out
        if (age < LOST_TIMEOUT_MS) {
          t.opacity = Math.min(1, t.opacity + FADE_IN_SPEED);
        } else {
          t.opacity = Math.max(0, t.opacity - FADE_OUT_SPEED);
        }
      }

      // Draw tracked boxes
      ctx.font = "bold 14px sans-serif";

      for (const t of tracked) {
        if (t.score < aiThreshold) continue;
        if (t.opacity <= 0.01) continue;

        let isPerson = false;
        let isPet = false;
        let isObj = false;

        const personClasses = ["person"];
        const petClasses = ["cat", "dog", "bird", "horse", "sheep", "cow"];

        if (personClasses.includes(t.cls)) isPerson = true;
        else if (petClasses.includes(t.cls)) isPet = true;
        else isObj = true;

        // Filter by checkbox
        if (isPerson && !showPersonRef.current) continue;
        if (isPet && !showPetRef.current) continue;
        if (isObj && !showObjectRef.current) continue;

        filteredCount++;

        const sx = w / t.frameWidth;
        const sy = h / t.frameHeight;
        const bx = t.cx * sx;
        const by = t.cy * sy;
        const bw = t.cw * sx;
        const bh = t.ch * sy;
        const alpha = t.opacity;

        const borderColor = isPerson
          ? `rgba(239, 68, 68, ${alpha})`
          : isPet ? `rgba(16, 185, 129, ${alpha})`
          : `rgba(59, 130, 246, ${alpha})`;
        const fillColor = isPerson
          ? `rgba(239, 68, 68, ${0.15 * alpha})`
          : isPet ? `rgba(16, 185, 129, ${0.15 * alpha})`
          : `rgba(59, 130, 246, ${0.15 * alpha})`;
        const labelBg = isPerson
          ? `rgba(239, 68, 68, ${alpha})`
          : isPet ? `rgba(16, 185, 129, ${alpha})`
          : `rgba(59, 130, 246, ${alpha})`;

        ctx.lineWidth = 3;
        ctx.strokeStyle = borderColor;
        ctx.fillStyle = fillColor;
        ctx.strokeRect(bx, by, bw, bh);
        ctx.fillRect(bx, by, bw, bh);

        // Label box
        const labelText = `${t.cls} (${Math.round(t.score * 100)}%)`;
        const textMetrics = ctx.measureText(labelText);
        const labelW = textMetrics.width + 16;
        const labelH = 22;
        const labelY = Math.max(0, by - labelH - 2);

        ctx.fillStyle = labelBg;
        // Rounded label background
        const radius = 4;
        ctx.beginPath();
        ctx.moveTo(bx - 1.5 + radius, labelY);
        ctx.lineTo(bx - 1.5 + labelW - radius, labelY);
        ctx.quadraticCurveTo(bx - 1.5 + labelW, labelY, bx - 1.5 + labelW, labelY + radius);
        ctx.lineTo(bx - 1.5 + labelW, labelY + labelH - radius);
        ctx.quadraticCurveTo(bx - 1.5 + labelW, labelY + labelH, bx - 1.5 + labelW - radius, labelY + labelH);
        ctx.lineTo(bx - 1.5 + radius, labelY + labelH);
        ctx.quadraticCurveTo(bx - 1.5, labelY + labelH, bx - 1.5, labelY + labelH - radius);
        ctx.lineTo(bx - 1.5, labelY + radius);
        ctx.quadraticCurveTo(bx - 1.5, labelY, bx - 1.5 + radius, labelY);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.font = "bold 14px sans-serif";
        ctx.fillText(labelText, bx + 5, labelY + 16);
      }

      // Update detection count for status bar
      if (filteredCount !== detectionCount) {
        (window as any).__detCount = filteredCount;
      }

      raf = requestAnimationFrame(draw);
    };

    draw();

    // Poll detection count from rAF
    const countInterval = setInterval(() => {
      const c = (window as any).__detCount;
      if (c !== undefined) setDetectionCount(c);
    }, 500);

    return () => { cancelAnimationFrame(raf); clearInterval(countInterval); };
  }, [value, mode, polyPoints, hoverPoint, isDrawingRect, rectStart, rectCurrent, detectionCount]);

  if (!cameraId || !cameraEnabled) {
    return (
      <div className="relative w-full aspect-video rounded-md border border-dashed border-slate-700 bg-slate-950/80 flex items-center justify-center">
        <div className="text-center text-slate-500 max-w-sm px-4 space-y-1">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-400">Smart Preview & Masking</div>
          <div className="text-[10px] opacity-75">
            Simpan dan aktifkan kamera terlebih dahulu untuk menampilkan video pratinjau langsung & menggambar area masking.
          </div>
        </div>
      </div>
    );
  }

  const getRelativeCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    return { x, y };
  };

  const isPointInPolygon = (p: { x: number; y: number }, points: { x: number; y: number }[]) => {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i].x, yi = points[i].y;
      const xj = points[j].x, yj = points[j].y;
      const intersect = ((yi > p.y) !== (yj > p.y))
          && (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  };

  const removeArea = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (mode !== "exclude_rect") return;
    const coords = getRelativeCoords(e);
    if (!coords) return;
    setRectStart(coords);
    setRectCurrent(coords);
    setIsDrawingRect(true);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getRelativeCoords(e);
    if (!coords) return;

    if (mode === "exclude_rect" && isDrawingRect) {
      setRectCurrent(coords);
    } else if (mode.includes("poly") || mode === "tripwire") {
      setHoverPoint(coords);
    }

    if (mode === "none" || ((mode.includes("poly") || mode === "tripwire") && polyPoints.length === 0)) {
      let hovering = false;
      for (const zone of value) {
        if ((zone.type === "polygon" || zone.type === "line") && zone.points) {
          if (zone.type === "polygon") {
            if (isPointInPolygon(coords, zone.points)) { hovering = true; break; }
          } else if (zone.type === "line") {
            // Rough distance check for line hover (simplistic)
            hovering = false; // Disable hovering detection for lines to avoid complexity
          }
        } else if (zone.type === "rect" && zone.x != null && zone.y != null && zone.w != null && zone.h != null) {
          if (coords.x >= zone.x && coords.x <= zone.x + zone.w && coords.y >= zone.y && coords.y <= zone.y + zone.h) { hovering = true; break; }
        }
      }
      setIsHoveringZone(hovering);
    } else {
      setIsHoveringZone(false);
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (mode !== "exclude_rect" || !isDrawingRect) return;
    setIsDrawingRect(false);
    const coords = getRelativeCoords(e);
    if (!coords) return;
    const x = Math.min(rectStart.x, coords.x);
    const y = Math.min(rectStart.y, coords.y);
    const mw = Math.max(0.01, Math.abs(rectStart.x - coords.x));
    const mh = Math.max(0.01, Math.abs(rectStart.y - coords.y));
    if (mw > 0.02 && mh > 0.02) {
      onChange([...value, { type: "rect", zoneType: "exclude", x, y, w: mw, h: mh, enabled: true, name: `Mask Kotak ${value.length + 1}` }]);
    }
  };

  const finishPolygon = () => {
    if (mode === "tripwire" && polyPoints.length < 2) return;
    if (mode.includes("poly") && polyPoints.length < 3) return;
    
    let zoneType: "exclude" | "intrusion" | "tripwire" = "exclude";
    let type: "polygon" | "line" = "polygon";
    let namePrefix = "Mask Polygon";

    if (mode === "tripwire") {
      zoneType = "tripwire";
      type = "line";
      namePrefix = "Tripwire";
    } else if (mode === "intrusion_poly") {
      zoneType = "intrusion";
      type = "polygon";
      namePrefix = "Intrusion Zone";
    }

    onChange([...value, { type, zoneType, points: polyPoints, enabled: true, name: `${namePrefix} ${value.length + 1}` }]);
    setPolyPoints([]);
    setHoverPoint(null);
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getRelativeCoords(e);
    if (!coords) return;
    if (mode.includes("poly") || mode === "tripwire") {
      if (mode.includes("poly") && polyPoints.length >= 3) {
        const first = polyPoints[0];
        const dx = coords.x - first.x;
        const dy = coords.y - first.y;
        if (Math.sqrt(dx * dx + dy * dy) < 0.03) { finishPolygon(); return; }
      }
      setPolyPoints((prev) => [...prev, coords]);
    } else if (mode === "none" || (mode === "exclude_rect" && !isDrawingRect)) {
      for (let i = value.length - 1; i >= 0; i--) {
        const zone = value[i];
        let hit = false;
        if (zone.type === "polygon" && zone.points) { hit = isPointInPolygon(coords, zone.points); }
        else if (zone.type === "rect" && zone.x != null && zone.y != null && zone.w != null && zone.h != null) {
          hit = coords.x >= zone.x && coords.x <= zone.x + zone.w && coords.y >= zone.y && coords.y <= zone.y + zone.h;
        }
        if (hit) { removeArea(i); return; }
      }
    }
  };

  const undoPoint = () => { setPolyPoints((prev) => prev.slice(0, -1)); };

  const motionSensLabel = motionSensitivityValue > 85 ? "Extreme" : motionSensitivityValue > 70 ? "Very High" : motionSensitivityValue > 50 ? "High" : motionSensitivityValue > 30 ? "Medium" : "Low";

  return (
    <div className="space-y-3">
      {/* ══════ Inline Filter Controls ══════ */}
      <div className="rounded-lg border border-slate-700/50 bg-slate-900/60 p-3 space-y-3">
        {/* Row 1: Detection type toggles */}
        <div className="flex flex-wrap items-center gap-4 text-sm px-2">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <div className="relative flex items-center">
              <input type="checkbox" checked={showPerson} onChange={(e) => onShowPersonChange?.(e.target.checked)} className="peer sr-only" />
              <div className="h-4 w-4 rounded-sm border border-slate-700 bg-slate-900 peer-checked:bg-rose-500 peer-checked:border-rose-500"></div>
              <svg className="absolute left-0 top-0 h-4 w-4 text-white opacity-0 peer-checked:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            </div>
            <div className="w-2.5 h-2.5 rounded-full bg-rose-500"></div>
            <span className="font-medium text-slate-200">Human / Person</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <div className="relative flex items-center">
              <input type="checkbox" checked={showPet} onChange={(e) => onShowPetChange?.(e.target.checked)} className="peer sr-only" />
              <div className="h-4 w-4 rounded-sm border border-slate-700 bg-slate-900 peer-checked:bg-emerald-500 peer-checked:border-emerald-500"></div>
              <svg className="absolute left-0 top-0 h-4 w-4 text-white opacity-0 peer-checked:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            </div>
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500"></div>
            <span className="font-medium text-slate-200">Pet</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <div className="relative flex items-center">
              <input type="checkbox" checked={showObject} onChange={(e) => onShowObjectChange?.(e.target.checked)} className="peer sr-only" />
              <div className="h-4 w-4 rounded-sm border border-slate-700 bg-slate-900 peer-checked:bg-blue-500 peer-checked:border-blue-500"></div>
              <svg className="absolute left-0 top-0 h-4 w-4 text-white opacity-0 peer-checked:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            </div>
            <div className="w-2.5 h-2.5 rounded-full bg-blue-500"></div>
            <span className="font-medium text-slate-200">Object</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer ml-4">
            <input
              type="checkbox"
              checked={showPixelMotion}
              onChange={(e) => onShowPixelMotionChange?.(e.target.checked)}
              className="w-4 h-4 accent-amber-500 cursor-pointer rounded"
            />
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-500" />
              Image Change (Motion)
            </span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none text-sm font-medium text-slate-200 ml-4">
            <input
              type="checkbox"
              checked={enableSoundDetection}
              onChange={(e) => onEnableSoundDetectionChange?.(e.target.checked)}
              className="w-4 h-4 accent-indigo-500 cursor-pointer rounded"
            />
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-indigo-500" />
              Sound Detection
            </span>
          </label>
        </div>

        <hr className="border-slate-700/40" />

        {/* Row 2: Sensitivity controls */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <label htmlFor="ai-sens-slider" className="font-medium whitespace-nowrap">AI Sensitivity:</label>
            <input
              id="ai-sens-slider"
              type="range"
              min={1}
              max={100}
              value={aiSensitivity}
              onChange={(e) => onAiSensitivityChange?.(Number(e.target.value))}
              className="w-24 accent-rose-500 cursor-pointer"
            />
            <span className="text-rose-400 font-semibold min-w-[40px]">{aiSensitivity}%</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <label htmlFor="motion-sens-slider" className="font-medium whitespace-nowrap">Motion Sensitivity:</label>
            <input
              id="motion-sens-slider"
              type="range"
              min={1}
              max={100}
              value={motionSensitivityValue}
              onChange={(e) => onMotionSensitivityChange?.(Number(e.target.value))}
              className="w-24 accent-amber-500 cursor-pointer"
            />
            <span className="text-amber-400 font-semibold min-w-[60px]">{motionSensLabel}</span>
          </div>
        </div>
      </div>

      {/* ══════ Drawing Toolbar ══════ */}
      <div className="flex flex-wrap items-center gap-2 bg-slate-900/40 p-2 rounded-lg border border-slate-800">
        <div className="flex items-center gap-1 border-r border-slate-700 pr-2">
          <Button
            type="button"
            variant={mode === "tripwire" ? "default" : "ghost"}
            size="sm"
            onClick={() => {
              setPolyPoints([]); setHoverPoint(null);
              setMode(mode === "tripwire" ? "none" : "tripwire");
            }}
            className={cn("text-[11px] h-7 px-2", mode === "tripwire" && "bg-orange-600 hover:bg-orange-700")}
          >
            〰️ Tripwire
          </Button>
          <Button
            type="button"
            variant={mode === "intrusion_poly" ? "default" : "ghost"}
            size="sm"
            onClick={() => {
              setPolyPoints([]); setHoverPoint(null);
              setMode(mode === "intrusion_poly" ? "none" : "intrusion_poly");
            }}
            className={cn("text-[11px] h-7 px-2", mode === "intrusion_poly" && "bg-yellow-600 hover:bg-yellow-700")}
          >
            ⚠️ Intrusion Zone
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant={mode === "exclude_poly" ? "default" : "ghost"}
            size="sm"
            onClick={() => {
              setPolyPoints([]); setHoverPoint(null);
              setMode(mode === "exclude_poly" ? "none" : "exclude_poly");
            }}
            className={cn("text-[11px] h-7 px-2", mode === "exclude_poly" && "bg-red-600 hover:bg-red-700")}
            title="Abaikan gerakan di area ini (Polygon)"
          >
            🚫 Exclude Poly
          </Button>
          <Button
            type="button"
            variant={mode === "exclude_rect" ? "default" : "ghost"}
            size="sm"
            onClick={() => { setMode(mode === "exclude_rect" ? "none" : "exclude_rect"); }}
            className={cn("text-[11px] h-7 px-2", mode === "exclude_rect" && "bg-red-600 hover:bg-red-700")}
            title="Abaikan gerakan di area ini (Kotak)"
          >
            🚫 Exclude Kotak
          </Button>
        </div>

        {(mode.includes("poly") || mode === "tripwire") && polyPoints.length > 0 && (
          <div className="flex items-center gap-1 ml-2">
            <Button type="button" variant="outline" size="sm" onClick={undoPoint} className="text-[11px] h-7 px-2">
              ↩ Undo
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={finishPolygon}
              disabled={mode === "tripwire" ? polyPoints.length < 2 : polyPoints.length < 3}
              className="text-[11px] h-7 px-2 bg-green-600 hover:bg-green-700 text-white font-medium animate-pulse"
            >
              ✓ Simpan ({polyPoints.length} titik)
            </Button>
          </div>
        )}

        <div className="flex-1" />
        <span className="text-xs text-muted-foreground font-mono">
          {value.length} Zones
        </span>
        {value.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange([])}
            className="text-[11px] text-destructive hover:bg-destructive/10 h-7 px-2"
          >
            Hapus Semua
          </Button>
        )}
      </div>

      {/* ══════ Editor & Live Preview Stage ══════ */}
      <div className="relative w-full aspect-video border bg-slate-950 rounded-lg overflow-hidden border-slate-800 select-none">
        <img
          ref={imgRef}
          src={mjpegSrc}
          alt="Live MJPEG"
          className="w-full h-full object-contain block"
          crossOrigin="anonymous"
          onLoad={() => setImgLoaded(true)}
        />
        
        {!imgLoaded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 text-slate-400 gap-2 z-0">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-700 border-t-primary" />
            <span className="text-[10px] uppercase tracking-wider font-semibold">Menghubungkan Stream MJPEG...</span>
          </div>
        )}

        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onClick={handleCanvasClick}
          className="absolute inset-0 w-full h-full z-10"
          style={{
            cursor: mode === "polygon" ? "crosshair" : mode === "rect" ? "crosshair" : isHoveringZone ? "pointer" : "default"
          }}
        />

        {/* Removed overlay SSE connection indicator to avoid blocking camera timestamp */}
        {showPixelMotion && (
          <div className="absolute top-2 right-2 px-2 py-0.5 rounded bg-black/60 text-[9px] font-mono text-green-400 z-20">
            Activity: {activity} blocks
          </div>
        )}
        {/* Helper guide */}
        {mode !== "none" && (
          <div className="absolute bottom-2 left-2 right-2 bg-black/85 border border-slate-700/50 backdrop-blur-sm px-2 py-1.5 rounded text-[10px] text-yellow-200 z-20 animate-fade-in font-medium">
            {mode === "polygon"
              ? "💡 Klik pada video untuk menambah titik. Klik lingkaran titik awal (pertama) untuk menyimpan polygon mask."
              : "💡 Klik dan seret mouse pada video untuk menggambar kotak mask."}
          </div>
        )}
      </div>

      {/* ══════ Status Bar ══════ */}
      <div className="text-xs text-slate-400 font-mono px-1 flex items-center justify-between">
        <div>
          Objects: <span className="text-white font-semibold">{detectionCount}</span>
          {" | "}
          <span className="font-semibold">FPS: {currentFps}</span>
          {isMotionDetected && showPixelMotion && (
            <span className="text-red-400 font-bold animate-pulse ml-2">● MOTION DETECTED</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[10px]">
          <span className={cn("w-1.5 h-1.5 rounded-full", connected ? "bg-green-500" : "bg-red-500 animate-pulse")} />
          <span>{connected ? "Connected" : "Reconnecting"}</span>
        </div>
      </div>

      {/* Ignore Areas list */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {value.map((area, idx) => (
            <div
              key={idx}
              className="flex items-center gap-1.5 text-[10px] bg-red-950/40 text-red-200 border border-red-500/30 px-2 py-0.5 rounded font-mono"
            >
              <span>{area.name || `Mask ${idx + 1}`} ({area.type === "polygon" ? `${area.points?.length}pt` : "rect"})</span>
              <button
                type="button"
                onClick={() => removeArea(idx)}
                className="text-red-400 hover:text-red-200 font-bold ml-1 text-xs"
                title="Hapus area ini"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
