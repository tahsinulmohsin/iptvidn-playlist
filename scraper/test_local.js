// Quick local test of the API handler logic
const IPTVIDN_BASE = 'http://iptvidn.com';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Referer: 'http://iptvidn.com/',
};
const CATEGORY_MAP = {
  lsports: 'Live Sports', sports: 'Sports', news: 'News', bangla: 'Bangla',
  hindi: 'Hindi', movies: 'Movies', music: 'Music', documentary: 'Documentary', kids: 'Kids',
};

async function test() {
  try {
    console.log('Step 1: Fetching main page...');
    const mainRes = await fetch(IPTVIDN_BASE, { headers: HEADERS });
    const mainHtml = await mainRes.text();
    console.log(`Main page: ${mainRes.status}, ${mainHtml.length} chars`);
    
    // Extract channels
    const channels = [];
    const seen = new Set();
    const regex = /<div\s+class="item\s+([^"]+)"[\s\S]*?play\.php\?stream=([^'"&\s]+)[\s\S]*?<img\s+src="([^"]*)"[^>]*>/g;
    let match;
    while ((match = regex.exec(mainHtml)) !== null) {
      const cssClass = match[1].trim();
      const streamName = match[2];
      if (seen.has(streamName)) continue;
      seen.add(streamName);
      channels.push({ streamName, category: CATEGORY_MAP[cssClass] || cssClass, displayName: streamName.replace(/-/g, ' ') });
    }
    console.log(`Step 2: Found ${channels.length} channels`);
    
    // Resolve first 3 streams
    console.log('\nStep 3: Resolving streams...');
    for (const ch of channels.slice(0, 3)) {
      try {
        const r = await fetch(`${IPTVIDN_BASE}/play.php?stream=${ch.streamName}`, { headers: HEADERS });
        const html = await r.text();
        const m = html.match(/src="http:\/\/([^:]+:\d+)\/([^/]+)\/embed\.html\?token=([^"&]+)(?:&remote=([^"]*))?"/);
        if (m) {
          const url = `http://${m[1]}/${m[2]}/mpegts?token=${m[3]}&remote=${m[4] || 'no_check_ip'}`;
          console.log(`  ✅ ${ch.streamName} → ${url.substring(0, 80)}...`);
        } else {
          console.log(`  ❌ ${ch.streamName} — no embed URL found`);
          console.log(`     HTML: ${html.substring(0, 200)}`);
        }
      } catch(e) {
        console.log(`  ❌ ${ch.streamName}: ${e.message}`);
      }
    }
    
    console.log('\n✅ Logic works!');
  } catch(e) {
    console.error('Error:', e);
  }
}

test();
