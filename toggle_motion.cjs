const http = require('http');

http.get('http://172.20.20.197:4200/api/cameras', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const cameras = JSON.parse(data);
    cameras.forEach(cam => {
      let modes = cam.detectionModes || ["pixel", "human", "pet"];
      modes = modes.filter(m => m !== "pixel");
      const payload = JSON.stringify({ detectionModes: modes });
      
      const req = http.request({
        hostname: '172.20.20.197',
        port: 4200,
        path: `/api/cameras/${cam.id}`,
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, (res2) => {
        console.log(`Updated ${cam.name} (${cam.id}) - Status: ${res2.statusCode}`);
      });
      req.write(payload);
      req.end();
    });
  });
});
