import onvif from 'node-onvif';
const d = new onvif.OnvifDevice({ xaddr: 'a' });
d.information = { Manufacturer: "A", Model: "B", FirmwareVersion: "C" };
console.log(d.getInformation());
