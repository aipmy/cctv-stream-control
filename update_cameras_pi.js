import fs from 'fs';
const path = './backend/data/cameras.json';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));
data.forEach(cam => {
  let modes = cam.detectionModes || ["pixel", "human", "pet"];
  cam.detectionModes = modes.filter(m => m !== "pixel");
});
fs.writeFileSync(path, JSON.stringify(data, null, 2));
console.log('Updated cameras.json on Pi');
