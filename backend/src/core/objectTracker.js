export function checkLineIntersection(p1, p2, p3, p4) {
  const ccw = (A, B, C) => (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x);
  return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
}

export function pointInPolygon(point, vs) {
  let x = point.x, y = point.y;
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    let xi = vs[i].x, yi = vs[i].y;
    let xj = vs[j].x, yj = vs[j].y;
    let intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function distance(p1, p2) {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

export class ObjectTracker {
  constructor() {
    this.nextId = 1;
    this.trackedObjects = [];
    this.maxDisappeared = 5; 
    this.maxHistory = 20; 
  }

  update(predictions) {
    if (!predictions) predictions = [];

    const newObjects = predictions.map(p => {
      const w = p.bbox[2];
      const h = p.bbox[3];
      const cx = p.bbox[0] + w / 2;
      const cy = p.bbox[1] + h / 2;
      return {
        centroid: { x: cx, y: cy },
        class: p.class,
        score: p.score,
        bbox: p.bbox,
        matched: false
      };
    });

    for (const tracked of this.trackedObjects) {
      let bestMatchIdx = -1;
      let minDistance = 150; 

      for (let i = 0; i < newObjects.length; i++) {
        const newObj = newObjects[i];
        if (newObj.matched) continue; 
        if (newObj.class !== tracked.class) continue; 

        const dist = distance(tracked.centroid, newObj.centroid);
        if (dist < minDistance) {
          minDistance = dist;
          bestMatchIdx = i;
        }
      }

      if (bestMatchIdx !== -1) {
        const match = newObjects[bestMatchIdx];
        match.matched = true;
        tracked.centroid = match.centroid;
        tracked.bbox = match.bbox;
        tracked.score = match.score;
        tracked.disappeared = 0;
        tracked.history.push(match.centroid);
        if (tracked.history.length > this.maxHistory) {
          tracked.history.shift();
        }
      } else {
        tracked.disappeared++;
      }
    }

    for (const newObj of newObjects) {
      if (!newObj.matched) {
        this.trackedObjects.push({
          id: this.nextId++,
          class: newObj.class,
          score: newObj.score,
          bbox: newObj.bbox,
          centroid: newObj.centroid,
          history: [newObj.centroid],
          disappeared: 0,
          triggeredZones: new Set()
        });
      }
    }

    this.trackedObjects = this.trackedObjects.filter(t => t.disappeared < this.maxDisappeared);
    return this.trackedObjects;
  }

  checkZones(smartZones, frameWidth, frameHeight) {
    if (!smartZones || smartZones.length === 0) return [];
    
    const triggeredEvents = [];
    const activeZones = smartZones.filter(z => 
      z.enabled !== false && 
      (z.zoneType === "tripwire" || z.zoneType === "intrusion")
    );

    if (activeZones.length === 0) return [];

    for (const obj of this.trackedObjects) {
      if (obj.disappeared > 0) continue;

      for (const zone of activeZones) {
        const isTriggered = this._checkObjectAgainstZone(obj, zone, frameWidth, frameHeight);

        if (isTriggered) {
          const zoneKey = `${zone.name}_${zone.zoneType}`;
          if (!obj.triggeredZones.has(zoneKey)) {
            obj.triggeredZones.add(zoneKey);
            triggeredEvents.push({
              objectClass: obj.class,
              score: obj.score,
              bbox: obj.bbox,
              zoneName: zone.name,
              zoneType: zone.zoneType
            });
          }
        }
      }
    }

    return triggeredEvents;
  }

  _checkObjectAgainstZone(obj, zone, frameWidth, frameHeight) {
    if (zone.zoneType === "tripwire" && zone.type === "line" && zone.points?.length >= 2) {
      const lineP1 = { x: zone.points[0].x * frameWidth, y: zone.points[0].y * frameHeight };
      const lineP2 = { x: zone.points[1].x * frameWidth, y: zone.points[1].y * frameHeight };

      if (obj.history.length < 2) return false;
      const p1 = obj.history[obj.history.length - 2];
      const p2 = obj.history[obj.history.length - 1];
      
      return checkLineIntersection(p1, p2, lineP1, lineP2);
    } 
    
    if (zone.zoneType === "intrusion") {
      if (zone.type === "polygon" && zone.points?.length >= 3) {
        const polyPts = zone.points.map(p => ({ x: p.x * frameWidth, y: p.y * frameHeight }));
        return pointInPolygon(obj.centroid, polyPts);
      } else if (zone.type === "rect") {
        const x = zone.x * frameWidth;
        const y = zone.y * frameHeight;
        const w = zone.w * frameWidth;
        const h = zone.h * frameHeight;
        const cx = obj.centroid.x;
        const cy = obj.centroid.y;
        return (cx >= x && cx <= x + w && cy >= y && cy <= y + h);
      }
    }
    
    return false;
  }
}
