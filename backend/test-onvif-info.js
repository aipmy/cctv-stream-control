import onvif from 'node-onvif';
const d = new onvif.OnvifDevice({ xaddr: 'a' });
console.log(typeof d.getInformation);
