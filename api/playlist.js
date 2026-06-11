export const config = {
  runtime: 'edge',
};

const IPTVIDN_BASE = 'http://iptvidn.com'; // Using domain, Edge runs on Cloudflare

const CATEGORY_MAP = {
  lsports: 'Live Sports',
  sports: 'Sports',
  news: 'News',
  bangla: 'Bangla',
  hindi: 'Hindi',
  movies: 'Movies',
  music: 'Music',
  documentary: 'Documentary',
  kids: 'Kids',
};

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Referer: 'http://iptvidn.com/',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      },
    });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    console.log('🚀 IPTVIDN Edge scraper started at', new Date().toISOString());

    // ── Step 1: Fetch the main page HTML ────────────────────────────
    const mainRes = await fetchWithTimeout(IPTVIDN_BASE, { headers: HEADERS }, 10000);
    const mainHtml = await mainRes.text();

    // ── Step 2: Extract all channel entries from the HTML ────────────
    const channelEntries = extractChannelsFromHtml(mainHtml);
    console.log(`📺 Found ${channelEntries.length} channel entries`);

    if (channelEntries.length === 0) {
      return new Response(JSON.stringify({ error: 'No channels found on iptvidn.com' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ── Step 3: Resolve stream URLs for ALL channels in parallel ────
    const results = await Promise.allSettled(
      channelEntries.map((ch) => resolveStreamUrl(ch))
    );
    const resolvedChannels = results
      .filter((r) => r.status === 'fulfilled' && r.value)
      .map((r) => r.value);

    console.log(`✅ Resolved ${resolvedChannels.length}/${channelEntries.length} streams`);

    // ── Step 4: Generate M3U8 playlist ──────────────────────────────
    const playlist = buildM3U8(resolvedChannels);

    // ── Step 5: Send response with cache headers ────────────────────
    return new Response(playlist, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
        'Content-Disposition': 'inline; filename="playlist.m3u8"',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 's-maxage=1200, stale-while-revalidate=600',
        'X-Playlist-Channels': String(resolvedChannels.length),
      },
    });
  } catch (err) {
    console.error('❌ Scraper error:', err);
    return new Response(
      JSON.stringify({ error: 'Failed to generate playlist', message: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────
// HTML Parsing — extract channels from iptvidn.com main page
// ─────────────────────────────────────────────────────────────────────

function extractChannelsFromHtml(html) {
  const channels = [];
  const seen = new Set();

  const regex =
    /<div\s+class="item\s+([^"]+)"[\s\S]*?play\.php\?stream=([^'"&\s]+)[\s\S]*?<img\s+src="([^"]*)"[^>]*>/g;

  let match;
  while ((match = regex.exec(html)) !== null) {
    const cssClass = match[1].trim();
    const streamName = match[2];
    const imgSrc = match[3];

    if (seen.has(streamName)) continue;
    seen.add(streamName);

    const category = CATEGORY_MAP[cssClass] || cssClass;
    const displayName = streamName.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const logo = imgSrc.startsWith('http') ? imgSrc : `${IPTVIDN_BASE}/${imgSrc}`;

    channels.push({ streamName, displayName, category, logo });
  }

  const allStreams = [...html.matchAll(/play\.php\?stream=([^'"&\s]+)/g)];
  for (const m of allStreams) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      channels.push({
        streamName: m[1],
        displayName: m[1].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        category: 'Other',
        logo: '',
      });
    }
  }

  return channels;
}

// ─────────────────────────────────────────────────────────────────────
// Stream Resolution — get token from play.php, construct MPEG-TS URL
// ─────────────────────────────────────────────────────────────────────

async function resolveStreamUrl(channel) {
  try {
    const playUrl = `${IPTVIDN_BASE}/play.php?stream=${channel.streamName}`;
    const res = await fetchWithTimeout(playUrl, { headers: HEADERS }, 5000);

    if (!res.ok) return null;

    const html = await res.text();

    const embedMatch = html.match(
      /src="http:\/\/([^:]+:\d+)\/([^/]+)\/embed\.html\?token=([^"&]+)(?:&remote=([^"]*))?"/ 
    );

    if (!embedMatch) return null;

    const host = embedMatch[1];
    const streamPath = embedMatch[2];
    const token = embedMatch[3];
    const remote = embedMatch[4] || 'no_check_ip';

    const streamUrl = `http://${host}/${streamPath}/mpegts?token=${token}&remote=${remote}`;

    return { ...channel, url: streamUrl, host, token };
  } catch (e) {
    console.warn(`⚠️ Failed to resolve ${channel.streamName}: ${e.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// M3U8 Generator
// ─────────────────────────────────────────────────────────────────────

function buildM3U8(channels) {
  const timestamp = new Date().toISOString();
  const lines = [
    '#EXTM3U',
    `# IPTVIDN Playlist — Auto-generated`,
    `# Last updated: ${timestamp}`,
    `# Total channels: ${channels.length}`,
    `# Source: http://iptvidn.com`,
    `# GitHub: https://github.com/tahsinulmohsin/iptvidn-playlist`,
    '',
  ];

  const sorted = [...channels].sort((a, b) => {
    const cat = a.category.localeCompare(b.category);
    return cat !== 0 ? cat : a.displayName.localeCompare(b.displayName);
  });

  for (const ch of sorted) {
    if (!ch.url) continue;

    let extinf = `#EXTINF:-1 tvg-name="${esc(ch.displayName)}"`;
    if (ch.logo) extinf += ` tvg-logo="${esc(ch.logo)}"`;
    extinf += ` group-title="${esc(ch.category)}",${ch.displayName}`;

    lines.push(extinf);
    lines.push(ch.url);
  }

  return lines.join('\n') + '\n';
}

function esc(s) {
  return (s || '').replace(/"/g, "'");
}

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
