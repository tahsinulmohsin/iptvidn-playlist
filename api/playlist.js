const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

/**
 * Vercel Serverless Function — IPTVIDN M3U8 Playlist Generator
 * 
 * Scrapes channels from iptvidn.com using headless Chrome,
 * generates an M3U8 playlist, and serves it with 20-minute CDN caching.
 * 
 * Endpoint: GET /api/playlist
 * Cache: s-maxage=1200 (20 min CDN), stale-while-revalidate=600 (10 min grace)
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🚀 IPTVIDN Scraper started at', new Date().toISOString());

    // Launch serverless-compatible Chromium
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const allChannels = [];
    const seenUrls = new Set();
    const interceptedStreams = new Map();

    try {
      const page = await browser.newPage();

      // Set realistic user agent
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
      );

      // Intercept network to capture .m3u8 URLs
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const type = request.resourceType();
        if (['image', 'font', 'stylesheet', 'media'].includes(type)) {
          request.abort();
        } else {
          request.continue();
        }
      });

      page.on('response', (response) => {
        const url = response.url();
        if (url.includes('.m3u8') || url.includes('/live/') || url.includes('/stream/')) {
          interceptedStreams.set(url, true);
        }
      });

      // Navigate to main page
      console.log('📡 Navigating to iptvidn.com');
      await page.goto('http://iptvidn.com', {
        waitUntil: 'networkidle2',
        timeout: 25000,
      });
      await sleep(3000);

      // Extract channels from main page DOM
      const mainChannels = await extractChannelsFromPage(page, 'All');
      console.log(`   Main page: ${mainChannels.length} channels`);

      for (const ch of mainChannels) {
        if (ch.url && !seenUrls.has(ch.url)) {
          seenUrls.add(ch.url);
          allChannels.push(ch);
        }
      }

      // Find all navigation links
      const navLinks = await page.evaluate(() => {
        const links = [];
        document.querySelectorAll('a[href]').forEach(a => {
          const href = a.getAttribute('href');
          const text = a.textContent.trim();
          if (href && text && !href.includes('.apk') && !href.startsWith('#') && !href.startsWith('javascript:')) {
            links.push({ href, text });
          }
        });
        return links;
      });

      // Visit each internal link
      for (const link of navLinks) {
        try {
          let fullUrl = link.href;
          if (fullUrl.startsWith('/')) fullUrl = 'http://iptvidn.com' + fullUrl;
          else if (!fullUrl.startsWith('http')) fullUrl = 'http://iptvidn.com/' + fullUrl;

          if (!fullUrl.includes('iptvidn.com')) continue;
          if (fullUrl.includes('.apk')) continue;

          console.log(`   📺 ${link.text} → ${fullUrl}`);
          await page.goto(fullUrl, { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
          await sleep(2000);

          const pageChannels = await extractChannelsFromPage(page, link.text || 'Uncategorized');
          for (const ch of pageChannels) {
            if (ch.url && !seenUrls.has(ch.url)) {
              seenUrls.add(ch.url);
              allChannels.push(ch);
            }
          }
        } catch (e) {
          console.warn(`   ⚠️ Error: ${e.message}`);
        }
      }

      // Add intercepted network streams
      for (const [streamUrl] of interceptedStreams) {
        if (!seenUrls.has(streamUrl)) {
          seenUrls.add(streamUrl);
          allChannels.push({
            name: extractNameFromUrl(streamUrl),
            url: streamUrl,
            logo: '',
            category: 'Discovered',
          });
        }
      }
    } finally {
      await browser.close();
    }

    console.log(`✅ Found ${allChannels.length} unique channels`);

    // Generate M3U8
    const playlist = generateM3U8(allChannels);

    // Set response headers — 20 min CDN cache + stale-while-revalidate
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Cache-Control', 's-maxage=1200, stale-while-revalidate=600');
    res.setHeader('X-Playlist-Channels', String(allChannels.length));
    res.setHeader('X-Playlist-Updated', new Date().toISOString());

    return res.status(200).send(playlist);
  } catch (err) {
    console.error('❌ Scraper error:', err);
    return res.status(500).json({
      error: 'Failed to generate playlist',
      message: err.message,
    });
  }
};

// ─── Channel Extraction ──────────────────────────────────────────────

async function extractChannelsFromPage(page, defaultCategory) {
  return page.evaluate((category) => {
    const results = [];
    const seen = new Set();

    // 1. Video/source elements
    document.querySelectorAll('video source, video[src]').forEach(el => {
      const src = el.getAttribute('src') || el.src;
      if (src && !seen.has(src)) {
        seen.add(src);
        results.push({ name: document.title || 'Unknown', url: src, logo: '', category });
      }
    });

    // 2. Iframe embeds
    document.querySelectorAll('iframe[src]').forEach(iframe => {
      const src = iframe.getAttribute('src') || iframe.src;
      if (src && (src.includes('.m3u8') || src.includes('/live/') || src.includes('/embed/'))) {
        if (!seen.has(src)) {
          seen.add(src);
          results.push({ name: iframe.getAttribute('title') || 'Stream', url: src, logo: '', category });
        }
      }
    });

    // 3. Channel cards / grid items
    const selectors = [
      '.channel-card', '.channel-item', '.card', '.grid-item',
      '.channel', '.tv-channel', '.stream-item',
      '[class*="channel"]', '[class*="stream"]', '[class*="card"]'
    ];
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach(card => {
        const link = card.querySelector('a[href]');
        const img = card.querySelector('img');
        const nameEl = card.querySelector('h2, h3, h4, h5, .title, .name, span');
        const href = link?.getAttribute('href') || '';
        const name = nameEl?.textContent?.trim() || card.textContent?.trim().substring(0, 50) || 'Unknown';
        const logo = img?.src || img?.getAttribute('data-src') || '';
        if (href && !seen.has(href)) {
          seen.add(href);
          results.push({ name, url: href, logo, category });
        }
      });
    }

    // 4. Anchor tags with stream URLs
    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href') || '';
      if (href.includes('.m3u8') || href.includes('/live/') || href.includes('/stream/') || href.includes('/play/')) {
        if (!seen.has(href)) {
          seen.add(href);
          results.push({
            name: a.textContent?.trim() || 'Unknown',
            url: href,
            logo: a.querySelector('img')?.src || '',
            category,
          });
        }
      }
    });

    // 5. Data attributes
    document.querySelectorAll('[data-url], [data-src], [data-stream], [data-href]').forEach(el => {
      const url = el.getAttribute('data-url') || el.getAttribute('data-src') ||
                  el.getAttribute('data-stream') || el.getAttribute('data-href') || '';
      if (url && !seen.has(url)) {
        seen.add(url);
        results.push({
          name: el.textContent?.trim()?.substring(0, 50) || 'Unknown',
          url, logo: el.querySelector('img')?.src || '', category,
        });
      }
    });

    // 6. Inline script M3U8 URLs
    document.querySelectorAll('script:not([src])').forEach(script => {
      const content = script.textContent || '';
      const regex = /["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)["']/g;
      let match;
      while ((match = regex.exec(content)) !== null) {
        if (!seen.has(match[1])) {
          seen.add(match[1]);
          results.push({ name: 'Discovered Stream', url: match[1], logo: '', category });
        }
      }
      const streamRegex = /["'](https?:\/\/[^"'\s]*\/(?:live|stream)\/[^"'\s]+)["']/g;
      while ((match = streamRegex.exec(content)) !== null) {
        if (!seen.has(match[1])) {
          seen.add(match[1]);
          results.push({ name: 'Discovered Stream', url: match[1], logo: '', category });
        }
      }
    });

    return results;
  }, defaultCategory);
}

// ─── M3U8 Generator ─────────────────────────────────────────────────

function generateM3U8(channels) {
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
    const cat = (a.category || '').localeCompare(b.category || '');
    return cat !== 0 ? cat : (a.name || '').localeCompare(b.name || '');
  });

  for (const ch of sorted) {
    const name = (ch.name || 'Unknown').trim().replace(/\s+/g, ' ');
    const logo = (ch.logo || '').trim();
    const category = (ch.category || 'Uncategorized').trim();
    const url = (ch.url || '').trim();

    if (!url || url === '#' || url === '/') continue;

    let extinf = `#EXTINF:-1 tvg-name="${esc(name)}"`;
    if (logo) extinf += ` tvg-logo="${esc(logo)}"`;
    extinf += ` group-title="${esc(category)}",${name}`;

    lines.push(extinf);
    lines.push(url);
  }

  return lines.join('\n') + '\n';
}

// ─── Helpers ─────────────────────────────────────────────────────────

function esc(s) { return s.replace(/"/g, "'"); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractNameFromUrl(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    for (const p of parts) {
      if (!p.includes('.') && !['live', 'stream', 'index'].includes(p)) {
        return p.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      }
    }
  } catch {}
  return 'Unknown Channel';
}
