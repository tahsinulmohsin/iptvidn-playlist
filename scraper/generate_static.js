const fs = require('fs');

const IPTVIDN_BASE = 'http://103.89.248.30'; // Origin IP
const CATEGORY_MAP = {
  lsports: 'Live Sports', sports: 'Sports', news: 'News', bangla: 'Bangla',
  hindi: 'Hindi', movies: 'Movies', music: 'Music', documentary: 'Documentary', kids: 'Kids',
};
const HEADERS = {
  Host: 'iptvidn.com',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Referer: 'http://iptvidn.com/',
};

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

async function run() {
  console.log('🚀 Fetching main page...');
  const mainRes = await fetchWithTimeout(IPTVIDN_BASE, { headers: HEADERS }, 10000);
  const mainHtml = await mainRes.text();
  
  const channels = [];
  const seen = new Set();
  const regex = /<div\s+class="item\s+([^"]+)"[\s\S]*?play\.php\?stream=([^'"&\s]+)[\s\S]*?<img\s+src="([^"]*)"[^>]*>/g;
  let match;
  while ((match = regex.exec(mainHtml)) !== null) {
    const cssClass = match[1].trim();
    const streamName = match[2];
    const imgSrc = match[3];
    if (seen.has(streamName)) continue;
    seen.add(streamName);
    const category = CATEGORY_MAP[cssClass] || cssClass;
    const displayName = streamName.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const logo = imgSrc.startsWith('http') ? imgSrc : `http://iptvidn.com/${imgSrc}`;
    channels.push({ streamName, displayName, category, logo });
  }

  console.log(`📺 Found ${channels.length} channels. Resolving streams...`);
  
  const resolvedChannels = [];
  const results = await Promise.allSettled(channels.map(async (ch) => {
    try {
      const playUrl = `${IPTVIDN_BASE}/play.php?stream=${ch.streamName}`;
      const res = await fetchWithTimeout(playUrl, { headers: HEADERS }, 10000);
      if (!res.ok) return null;
      const html = await res.text();
      const embedMatch = html.match(/src="http:\/\/([^:]+:\d+)\/([^/]+)\/embed\.html\?token=([^"&]+)(?:&remote=([^"]*))?"/);
      if (!embedMatch) return null;
      const host = embedMatch[1];
      const streamPath = embedMatch[2];
      const token = embedMatch[3];
      const remote = embedMatch[4] || 'no_check_ip';
      const url = `http://${host}/${streamPath}/mpegts?token=${token}&remote=${remote}`;
      return { ...ch, url };
    } catch(e) {
      return null;
    }
  }));

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      resolvedChannels.push(r.value);
    }
  }

  console.log(`✅ Resolved ${resolvedChannels.length} streams. Building M3U8...`);
  
  const timestamp = new Date().toISOString();
  const lines = [
    '#EXTM3U',
    `# IPTVIDN Playlist — Auto-generated`,
    `# Last updated: ${timestamp}`,
    `# Total channels: ${resolvedChannels.length}`,
    ''
  ];

  const sorted = [...resolvedChannels].sort((a, b) => a.category.localeCompare(b.category) || a.displayName.localeCompare(b.displayName));

  for (const ch of sorted) {
    lines.push(`#EXTINF:-1 tvg-name="${ch.displayName}" tvg-logo="${ch.logo}" group-title="${ch.category}",${ch.displayName}`);
    lines.push(ch.url);
  }

  const m3u8 = lines.join('\n') + '\n';
  fs.writeFileSync('public/playlist.m3u8', m3u8);
  console.log('✅ Generated public/playlist.m3u8!');
}

run().catch(console.error);
