const fs = require('fs');
const file = '/Users/aipmy/Projects/cctv-stream-control/src/components/SmartDetectionEditor.tsx';
let content = fs.readFileSync(file, 'utf8');

// Replace loop coords
content = content.replace(/zone\.points\[i\]\.x \* w/g, '(zone.points[i].x * drawW + offsetX)');
content = content.replace(/zone\.points\[i\]\.y \* h/g, '(zone.points[i].y * drawH + offsetY)');

content = content.replace(/previewPoints\[i\]\.x \* w/g, '(previewPoints[i].x * drawW + offsetX)');
content = content.replace(/previewPoints\[i\]\.y \* h/g, '(previewPoints[i].y * drawH + offsetY)');

// Replace AI Box coords if missed
content = content.replace(/const aiX = Math\.max\(0, box\.x \* w\);/g, 'const aiX = Math.max(offsetX, box.x * drawW + offsetX);');
content = content.replace(/const aiY = Math\.max\(0, box\.y \* h\);/g, 'const aiY = Math.max(offsetY, box.y * drawH + offsetY);');
content = content.replace(/const aiW = Math\.min\(w - aiX, box\.w \* w\);/g, 'const aiW = box.w * drawW;');
content = content.replace(/const aiH = Math\.min\(h - aiY, box\.h \* h\);/g, 'const aiH = box.h * drawH;');

content = content.replace(/const bx = Math\.max\(0, box\[0\] \* w\);/g, 'const bx = Math.max(offsetX, box[0] * drawW + offsetX);');
content = content.replace(/const by = Math\.max\(0, box\[1\] \* h\);/g, 'const by = Math.max(offsetY, box[1] * drawH + offsetY);');
content = content.replace(/const bw = Math\.min\(w - bx, box\[2\] \* w\);/g, 'const bw = box[2] * drawW;');
content = content.replace(/const bh = Math\.min\(h - by, box\[3\] \* h\);/g, 'const bh = box[3] * drawH;');

fs.writeFileSync(file, content);
console.log('Fixed coords');
