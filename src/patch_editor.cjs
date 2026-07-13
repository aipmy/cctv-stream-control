const fs = require('fs');
const file = '/Users/aipmy/Projects/cctv-stream-control/src/components/SmartDetectionEditor.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Replace mjpegSrc with hlsSrc
content = content.replace(
`  const mjpegSrc = useMemo(() => {
    const token = localStorage.getItem("cctv-lite-token") || "";
    const base = (typeof window !== "undefined" && ["5173", "5174", "8080"].includes(window.location.port))
      ? \`\${window.location.protocol}//\${window.location.hostname}:4200\`
      : "";
    return \`\${base}/api/streams/\${cameraId}/video.mjpg?token=\${encodeURIComponent(token)}&t=\${Date.now()}\`;
  }, [cameraId]);`,
`  const hlsSrc = useMemo(() => {
    const token = localStorage.getItem("cctv-lite-token") || "";
    const base = (typeof window !== "undefined" && ["5173", "5174", "8080"].includes(window.location.port))
      ? \`\${window.location.protocol}//\${window.location.hostname}:4200\`
      : "";
    return \`\${base}/api/streams/\${cameraId}/index.m3u8?token=\${encodeURIComponent(token)}&output=HLS%20Low%20Latency\`;
  }, [cameraId]);`
);

// 2. Change refs
content = content.replace('const imgRef = useRef<HTMLImageElement>(null);', 'const videoRef = useRef<HTMLVideoElement>(null);\n  const hlsRef = useRef<any>(null);');

// 3. Add HLS Lifecycle effect
const hlsLifecycle = `
  // HLS Lifecycle
  useEffect(() => {
    setImgLoaded(false);
    if (!hlsSrc || !videoRef.current) return;
    
    let disposed = false;
    
    const initHls = async () => {
      try {
        const mod = await import("hls.js");
        const HlsLib = mod.default;
        
        if (disposed) return;
        
        if (!HlsLib.isSupported()) {
          console.error("HLS not supported in this browser");
          return;
        }
        
        if (hlsRef.current) {
          hlsRef.current.destroy();
        }
        
        const hls = new HlsLib({
          maxBufferLength: 5,
          maxMaxBufferLength: 10,
          lowLatencyMode: true,
          backBufferLength: 5,
        });
        
        hlsRef.current = hls;
        
        hls.loadSource(hlsSrc);
        hls.attachMedia(videoRef.current!);
        
        hls.on(HlsLib.Events.MANIFEST_PARSED, () => {
          if (!disposed && videoRef.current) {
            videoRef.current.play().catch(console.error);
          }
        });
        
        hls.on(HlsLib.Events.ERROR, (_evt: any, data: any) => {
          if (data.fatal) {
            if (data.type === HlsLib.ErrorTypes.NETWORK_ERROR) {
              hls.startLoad();
            } else if (data.type === HlsLib.ErrorTypes.MEDIA_ERROR) {
              hls.recoverMediaError();
            } else {
              hls.destroy();
            }
          }
        });
        
      } catch (err) {
        console.error("Failed to load hls.js", err);
      }
    };
    
    initHls();
    
    return () => {
      disposed = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [hlsSrc]);
`;

content = content.replace(
`  // Reset image loaded status on stream URL change
  useEffect(() => {
    setImgLoaded(false);
  }, [mjpegSrc]);`, hlsLifecycle);


// 4. Update requestAnimationFrame loop
const rafOld = `      if (!canvas || !img) {
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
      }`;

const rafNew = `      const video = videoRef.current;
      if (!canvas || !video) {
        raf = requestAnimationFrame(draw);
        return;
      }

      const rect = video.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);

      if (w === 0 || h === 0 || video.videoWidth === 0) {
        raf = requestAnimationFrame(draw);
        return;
      }

      // Aspect ratio letterbox calculation
      let drawW = w;
      let drawH = h;
      let offsetX = 0;
      let offsetY = 0;
      
      const videoRatio = video.videoWidth / video.videoHeight;
      const containerRatio = w / h;
      if (videoRatio > containerRatio) {
        drawH = w / videoRatio;
        offsetY = (h - drawH) / 2;
      } else {
        drawW = h * videoRatio;
        offsetX = (w - drawW) / 2;
      }

      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }`;

content = content.replace(rafOld, rafNew);

// 5. Update draw coords in requestAnimationFrame loop
content = content.replace(/zone\.points\[(\d+)\]\.x \* w/g, '(zone.points[$1].x * drawW + offsetX)');
content = content.replace(/zone\.points\[(\d+)\]\.y \* h/g, '(zone.points[$1].y * drawH + offsetY)');
content = content.replace(/previewPoints\[(\d+)\]\.x \* w/g, '(previewPoints[$1].x * drawW + offsetX)');
content = content.replace(/previewPoints\[(\d+)\]\.y \* h/g, '(previewPoints[$1].y * drawH + offsetY)');
content = content.replace(/p\.x \* w/g, '(p.x * drawW + offsetX)');
content = content.replace(/p\.y \* h/g, '(p.y * drawH + offsetY)');

content = content.replace(/const zx = zone\.x \* w;/g, 'const zx = (zone.x * drawW + offsetX);');
content = content.replace(/const zy = zone\.y \* h;/g, 'const zy = (zone.y * drawH + offsetY);');
content = content.replace(/const zw = zone\.w \* w;/g, 'const zw = (zone.w * drawW);');
content = content.replace(/const zh = zone\.h \* h;/g, 'const zh = (zone.h * drawH);');

// 6. Update ai box draw coords
content = content.replace(/const aiX = Math\.max\(0, box\.x \* w\);/g, 'const aiX = Math.max(offsetX, box.x * drawW + offsetX);');
content = content.replace(/const aiY = Math\.max\(0, box\.y \* h\);/g, 'const aiY = Math.max(offsetY, box.y * drawH + offsetY);');
content = content.replace(/const aiW = Math\.min\(w - aiX, box\.w \* w\);/g, 'const aiW = box.w * drawW;');
content = content.replace(/const aiH = Math\.min\(h - aiY, box\.h \* h\);/g, 'const aiH = box.h * drawH;');

// 7. Update old box draw coords
content = content.replace(/const bx = Math\.max\(0, box\[0\] \* w\);/g, 'const bx = Math.max(offsetX, box[0] * drawW + offsetX);');
content = content.replace(/const by = Math\.max\(0, box\[1\] \* h\);/g, 'const by = Math.max(offsetY, box[1] * drawH + offsetY);');
content = content.replace(/const bw = Math\.min\(w - bx, box\[2\] \* w\);/g, 'const bw = box[2] * drawW;');
content = content.replace(/const bh = Math\.min\(h - by, box\[3\] \* h\);/g, 'const bh = box[3] * drawH;');

// 8. Update DOM elements
const domOld = `      <div className="relative w-full aspect-video border bg-slate-950 rounded-lg overflow-hidden border-slate-800 select-none">
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
        )}`;

const domNew = `      <div className="relative w-full aspect-video border bg-slate-950 rounded-lg overflow-hidden border-slate-800 select-none">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="w-full h-full object-contain block"
          crossOrigin="anonymous"
          onPlaying={() => setImgLoaded(true)}
        />
        
        {!imgLoaded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 text-slate-400 gap-2 z-0">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-700 border-t-primary" />
            <span className="text-[10px] uppercase tracking-wider font-semibold">Menghubungkan Stream HLS...</span>
          </div>
        )}`;

content = content.replace(domOld, domNew);

// 9. Fix handleMouseMove and handleMouseDown
content = content.replace(
`    const x = e.nativeEvent.offsetX / rect.width;
    const y = e.nativeEvent.offsetY / rect.height;`,
`    const video = videoRef.current;
    if (!video) return;
    const videoRatio = video.videoWidth / video.videoHeight;
    const containerRatio = rect.width / rect.height;
    let drawW = rect.width;
    let drawH = rect.height;
    let offsetX = 0;
    let offsetY = 0;
    if (videoRatio > containerRatio) {
      drawH = rect.width / videoRatio;
      offsetY = (rect.height - drawH) / 2;
    } else {
      drawW = rect.height * videoRatio;
      offsetX = (rect.width - drawW) / 2;
    }

    const x = Math.max(0, Math.min(1, (e.nativeEvent.offsetX - offsetX) / drawW));
    const y = Math.max(0, Math.min(1, (e.nativeEvent.offsetY - offsetY) / drawH));`
);

content = content.replace(
`    const x = e.nativeEvent.offsetX / rect.width;
    const y = e.nativeEvent.offsetY / rect.height;`,
`    const video = videoRef.current;
    if (!video) return;
    const videoRatio = video.videoWidth / video.videoHeight;
    const containerRatio = rect.width / rect.height;
    let drawW = rect.width;
    let drawH = rect.height;
    let offsetX = 0;
    let offsetY = 0;
    if (videoRatio > containerRatio) {
      drawH = rect.width / videoRatio;
      offsetY = (rect.height - drawH) / 2;
    } else {
      drawW = rect.height * videoRatio;
      offsetX = (rect.width - drawW) / 2;
    }

    const x = Math.max(0, Math.min(1, (e.nativeEvent.offsetX - offsetX) / drawW));
    const y = Math.max(0, Math.min(1, (e.nativeEvent.offsetY - offsetY) / drawH));`
);


// Save
fs.writeFileSync(file, content);
console.log('Patched');
