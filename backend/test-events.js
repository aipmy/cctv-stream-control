import onvif from 'node-onvif';

async function testEvents(ip, port, user, pass, name) {
  console.log(`\n============================`);
  console.log(`Testing Kamera: ${name} (${ip})`);
  console.log(`============================`);
  const device = new onvif.OnvifDevice({ xaddr: `http://${ip}:${port}/onvif/device_service`, user, pass });

  try {
    await device.init();
    if (device.services.events) {
      console.log("✅ Mendukung ONVIF Events!");
      
      // We can fetch event properties manually if node-onvif supports it
      // node-onvif might not have a high-level wrapper for getEventProperties, but let's try reading device.events
      console.log("Mencoba mengambil tipe event (Event Properties)...");
      try {
        let res = await device.services.events.getEventProperties();
        console.log("Supported Events:");
        // The response contains TopicSet which is an XML tree of supported events
        // Let's just stringify it deeply but slice it to avoid massive logs
        const topicsStr = JSON.stringify(res.data.GetEventPropertiesResponse.TopicSet, null, 2);
        
        // Extract common topics if possible
        const topics = [];
        if (topicsStr.includes("VideoAnalytics") || topicsStr.includes("MotionAlarm")) topics.push("Motion Detection (Deteksi Gerakan)");
        if (topicsStr.includes("AudioAnalytics")) topics.push("Audio Detection (Deteksi Suara)");
        if (topicsStr.includes("LineDetector")) topics.push("Line Crossing (Deteksi Garis)");
        if (topicsStr.includes("FieldDetector")) topics.push("Intrusion (Deteksi Masuk Area)");
        if (topicsStr.includes("Human")) topics.push("Human Detection (Deteksi Manusia)");
        if (topicsStr.includes("Vehicle")) topics.push("Vehicle Detection (Deteksi Kendaraan)");
        
        if (topics.length > 0) {
          topics.forEach(t => console.log(`  - ${t}`));
        } else {
          console.log("  (Tidak dapat membaca daftar spesifik, tapi service aktif)");
        }
      } catch (e) {
        console.log("  (Gagal membaca EventProperties detail:", e.message, ")");
      }
    } else {
      console.log("❌ TIDAK mendukung ONVIF Events.");
    }
  } catch (err) {
    console.error(`❌ Gagal terhubung ke ${name}:`, err.message);
  }
}

async function run() {
  await testEvents("172.16.50.252", 8000, "admin", "tamvan123", "Bardi Indoor");
}

run();
