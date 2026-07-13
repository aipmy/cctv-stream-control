const fs = require('fs');
const file = '/Users/aipmy/Projects/cctv-stream-control/src/components/SmartDetectionEditor.tsx';
let content = fs.readFileSync(file, 'utf8');

// Fix rect drawing (in-progress)
content = content.replace(/const rx = Math\.min\(rectStart\.x, rectCurrent\.x\) \* w;/g, 'const rx = (Math.min(rectStart.x, rectCurrent.x) * drawW + offsetX);');
content = content.replace(/const ry = Math\.min\(rectStart\.y, rectCurrent\.y\) \* h;/g, 'const ry = (Math.min(rectStart.y, rectCurrent.y) * drawH + offsetY);');
content = content.replace(/const rw = Math\.abs\(rectStart\.x - rectCurrent\.x\) \* w;/g, 'const rw = (Math.abs(rectStart.x - rectCurrent.x) * drawW);');
content = content.replace(/const rh = Math\.abs\(rectStart\.y - rectCurrent\.y\) \* h;/g, 'const rh = (Math.abs(rectStart.y - rectCurrent.y) * drawH);');

// Fix motion pixels (Green)
content = content.replace(/const sx = w \/ fw;/g, 'const sx = drawW / fw;');
content = content.replace(/const sy = h \/ fh;/g, 'const sy = drawH / fh;');
content = content.replace(/const bx = box\.x \* sx;/g, 'const bx = (box.x * sx + offsetX);');
content = content.replace(/const by = box\.y \* sy;/g, 'const by = (box.y * sy + offsetY);');

// Fix AI Bounding Boxes
content = content.replace(/const sx = w \/ box\.frameWidth;/g, 'const sx = drawW / box.frameWidth;');
content = content.replace(/const sy = h \/ box\.frameHeight;/g, 'const sy = drawH / box.frameHeight;');
content = content.replace(/const bx = box\.bbox\[0\] \* sx;/g, 'const bx = (box.bbox[0] * sx + offsetX);');
content = content.replace(/const by = box\.bbox\[1\] \* sy;/g, 'const by = (box.bbox[1] * sy + offsetY);');
content = content.replace(/const bw = box\.bbox\[2\] \* sx;/g, 'const bw = (box.bbox[2] * sx);');
content = content.replace(/const bh = box\.bbox\[3\] \* sy;/g, 'const bh = (box.bbox[3] * sy);');

fs.writeFileSync(file, content);
console.log('Fixed AI coords');
