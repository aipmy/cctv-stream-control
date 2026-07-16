export function calculateHealthScore(metrics, recovery = {}) {
  if (!metrics) {
    return { score: 0, status: "critical", reasons: ["No active stream session"] };
  }
  
  let score = 100;
  const reasons = [];

  // 1. Check speed (FFmpeg encoding speed)
  if (metrics.speed < 0.8) {
    score -= 25;
    reasons.push(`Critical encoder slowdown: speed is ${metrics.speed}x (needs to be >= 1.0x)`);
  } else if (metrics.speed < 0.95) {
    score -= 10;
    reasons.push(`Moderate encoder slowdown: speed is ${metrics.speed}x`);
  }

  // 2. Check segment delay
  if (metrics.segmentDelay > 2.0) {
    score -= 20;
    reasons.push(`Severe segment delivery delay: ${metrics.segmentDelay}s`);
  } else if (metrics.segmentDelay > 0.5) {
    score -= 10;
    reasons.push(`Mild segment delivery delay: ${metrics.segmentDelay}s`);
  }

  // 3. Check playlist updates (playlistAge)
  if (metrics.playlistAge > 12.0) { 
    score -= 30;
    reasons.push(`Playlist update stalled: last updated ${metrics.playlistAge}s ago`);
  } else if (metrics.playlistAge > 6.0) {
    score -= 10;
    reasons.push(`Playlist update delayed: last updated ${metrics.playlistAge}s ago`);
  }

  // 4. Check restarts
  const restarts = recovery.restartCount || 0;
  if (restarts > 3) {
    score -= 40;
    reasons.push(`Frequent crash restarts: ${restarts} times recently`);
  } else if (restarts > 0) {
    score -= 15 * restarts;
    reasons.push(`Stream restarted ${restarts} time(s) recently`);
  }

  // 5. Check dropped frames
  if (metrics.droppedFrames > 15) {
    score -= 15;
    reasons.push(`High dropped frames count: ${metrics.droppedFrames}`);
  } else if (metrics.droppedFrames > 2) {
    score -= 5;
    reasons.push(`Mild frame drops: ${metrics.droppedFrames}`);
  }

  // Bound the score
  score = Math.max(0, Math.min(100, score));

  // Determine status classification
  let status = "healthy";
  if (score >= 95) {
    status = "healthy"; // Excellent (Green 🟢)
  } else if (score >= 80) {
    status = "healthy"; // Good (Blue 🔵)
  } else if (score >= 60) {
    status = "degraded"; // Warning (Yellow 🟡)
  } else {
    status = "critical"; // Critical (Red 🔴)
  }

  return {
    score,
    status,
    reasons
  };
}
