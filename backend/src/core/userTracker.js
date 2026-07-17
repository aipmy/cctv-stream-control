const ipMap = new Map();

export function recordUserIp(ip, username) {
  if (!ip || !username) return;
  
  // Normalize IPv6 mapped IPv4 (e.g. ::ffff:192.168.1.5 -> 192.168.1.5)
  let normalizedIp = ip;
  if (normalizedIp.startsWith('::ffff:')) {
    normalizedIp = normalizedIp.substring(7);
  }
  
  ipMap.set(normalizedIp, {
    username,
    lastSeen: Date.now()
  });
}

export function getUsernameByIp(ipStr) {
  if (!ipStr) return null;
  
  // go2rtc remote_addr is usually like [::1]:55370 or 192.168.1.5:4312
  // We need to extract just the IP part
  let ip = ipStr;
  if (ip.startsWith('[')) {
    const end = ip.indexOf(']');
    if (end > -1) ip = ip.substring(1, end);
  } else if (ip.includes(':')) {
    // If it's IPv4 with port like 192.168.1.5:1234
    ip = ip.split(':')[0];
  }
  
  // Normalize
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }
  
  const record = ipMap.get(ip);
  if (record) {
    // Optional: expire after 1 hour
    if (Date.now() - record.lastSeen < 60 * 60 * 1000) {
      return record.username;
    } else {
      ipMap.delete(ip);
    }
  }
  return null;
}
