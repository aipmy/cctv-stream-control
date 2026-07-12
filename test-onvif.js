import onvif from 'node-onvif';

async function testCamera() {
  console.log("Menghubungi kamera...");
  const device = new onvif.OnvifDevice({
    xaddr: 'http://172.20.40.199:80/onvif/device_service',
    user: 'admin',
    pass: 'Avengedaip123'
  });

  try {
    await device.init();
    console.log("✅ Kamera Berhasil Terhubung!");
    console.log("--- Informasi Perangkat ---");
    console.log("Manufacturer : " + device.information.Manufacturer);
    console.log("Model        : " + device.information.Model);
    console.log("Firmware     : " + device.information.FirmwareVersion);
    console.log("---------------------------");
    
    const profile = device.getCurrentProfile();
    console.log("Profile Name : " + profile.name);
    
    if (device.services.ptz) {
      console.log("✅ PTZ DUKUNGAN TERSEDIA!");
      // Check if the current profile supports PTZ
      if (profile.ptz) {
        console.log("   -> Profil saat ini mendukung PTZ Motor!");
      } else {
        console.log("   -> Layanan PTZ ada, tapi profil video ini tidak mendukung PTZ.");
      }
    } else {
      console.log("❌ Kamera ini TIDAK mendukung PTZ via ONVIF.");
    }
  } catch (err) {
    console.error("❌ Gagal terhubung:", err.message);
  }
}

testCamera();
