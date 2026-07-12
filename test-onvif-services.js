import onvif from 'node-onvif';
import util from 'util';

async function testServices() {
  const device = new onvif.OnvifDevice({
    xaddr: 'http://172.20.40.199:80/onvif/device_service',
    user: 'admin',
    pass: 'Avengedaip123'
  });

  try {
    await device.init();
    console.log("Supported Services:");
    for (const [key, val] of Object.entries(device.services)) {
      if (val) console.log(`- ${key}`);
    }
    
    // Check imaging
    if (device.services.imaging) {
      console.log("\nImaging service found. Fetching video sources...");
      const profile = device.getCurrentProfile();
      if (profile && profile.video && profile.video.source) {
        console.log("Video source token:", profile.video.source.token);
        // Let's just print that imaging is possible
      }
    }
    
    // Check deviceIO
    if (device.services.deviceIO) {
      console.log("\nDeviceIO service found (Relays/Digital Inputs).");
    }

  } catch (err) {
    console.error(err);
  }
}

testServices();
