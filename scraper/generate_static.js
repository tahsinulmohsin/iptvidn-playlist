const fs = require('fs');

const IPTVIDN_BASE = 'http://103.89.248.30'; // Origin IP
const CATEGORY_MAP = {
  lsports: 'Live Sports', sports: 'Sports', news: 'News', bangla: 'Bangla',
  hindi: 'Hindi', movies: 'Movies', music: 'Music', documentary: 'Documentary', kids: 'Kids',
};

// Generic User-Agent that most browsers use
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const HEADERS = {
  Host: 'iptvidn.com',
  'User-Agent': USER_AGENT,
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

// Function to process array in batches to avoid WAF / Rate Limiting (403 Forbidden)
async function processInBatches(items, batchSize, processFn) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map(processFn));
    results.push(...batchResults);
    // Add a 1 second delay between batches to respect the server
    if (i + batchSize < items.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return results;
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

  console.log(`📺 Found ${channels.length} channels. Resolving streams with concurrency limit...`);
  
  const resolvedChannels = [];
  
  const results = await processInBatches(channels, 5, async (ch) => {
    try {
      const playUrl = `${IPTVIDN_BASE}/play.php?stream=${ch.streamName}`;
      const res = await fetchWithTimeout(playUrl, { headers: HEADERS }, 10000);
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const html = await res.text();
      const embedMatch = html.match(/src="http:\/\/([^:]+:\d+)\/([^/]+)\/embed\.html\?token=([^"&]+)(?:&remote=([^"]*))?"/);
      if (!embedMatch) throw new Error('No token found');
      const host = embedMatch[1];
      const streamPath = embedMatch[2];
      const token = embedMatch[3];
      const remote = embedMatch[4] || 'no_check_ip';
      
      // Base URL
      let url = `http://${host}/${streamPath}/mpegts?token=${token}&remote=${remote}`;
      
      // Append headers using the pipe syntax (Supported by TiviMate, OTT Navigator, etc)
      url += `|User-Agent=${encodeURIComponent(USER_AGENT)}&Referer=${encodeURIComponent('http://iptvidn.com/')}`;
      
      return { ...ch, url };
    } catch(e) {
      console.warn(`⚠️ Failed to resolve ${ch.streamName}: ${e.message}`);
      return null;
    }
  });

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
    // Add VLC-specific options for VLC player
    lines.push(`#EXTVLCOPT:http-user-agent=${USER_AGENT}`);
    lines.push(`#EXTVLCOPT:http-referrer=http://iptvidn.com/`);
    lines.push(ch.url);
  }

  const m3u8 = lines.join('\n') + '\n';
  
  if (!fs.existsSync('public')) {
    fs.mkdirSync('public');
  }
  fs.writeFileSync('public/playlist.m3u8', m3u8);
  console.log('✅ Generated public/playlist.m3u8!');
}

run().catch(console.error);
