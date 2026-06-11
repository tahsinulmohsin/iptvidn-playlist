const puppeteer = require('puppeteer');
const { parseChannels } = require('./parser');
const { generatePlaylist } = require('./generator');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://iptvidn.com';
const OUTPUT_PATH = path.join(__dirname, '..', 'public', 'playlist.m3u8');

const CATEGORIES = [
  { name: 'Live Sports', slug: 'live-sports' },
  { name: 'Sports', slug: 'sports' },
  { name: 'News', slug: 'news' },
  { name: 'Bangla', slug: 'bangla' },
  { name: 'Hindi', slug: 'hindi' },
  { name: 'Movies', slug: 'movies' },
  { name: 'Music', slug: 'music' },
  { name: 'Documentary', slug: 'documentary' },
  { name: 'Kids', slug: 'kids' }
];

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function scrapeAllChannels() {
  console.log('🚀 Starting IPTVIDN channel scraper...');
  console.log(`📅 ${new Date().toISOString()}\n`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--window-size=1920x1080'
    ]
  });

  const allChannels = [];
  const seenUrls = new Set();

  try {
    const page = await browser.newPage();

    // Set a realistic user agent
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    );

    // Set viewport
    await page.setViewport({ width: 1920, height: 1080 });

    // Intercept network requests to capture .m3u8 URLs
    const interceptedStreams = new Map();

    await page.setRequestInterception(true);
    page.on('request', (request) => {
      // Block images, fonts, stylesheets to speed up scraping
      const resourceType = request.resourceType();
      if (['image', 'font', 'stylesheet'].includes(resourceType)) {
        request.abort();
      } else {
        request.continue();
      }
    });

    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('.m3u8') || url.includes('/live/') || url.includes('/stream/')) {
        interceptedStreams.set(url, true);
      }
    });

    // Step 1: Navigate to the main page
    console.log('📡 Navigating to', BASE_URL);
    await page.goto(BASE_URL, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    await sleep(3000);

    // Step 2: Extract all channel links from the main page
    console.log('🔍 Extracting channel links from main page...');
    const mainPageChannels = await parseChannels(page, 'All');
    console.log(`   Found ${mainPageChannels.length} channels on main page`);

    // Step 3: Try to find and navigate to category pages
    const navLinks = await page.evaluate(() => {
      const links = [];
      document.querySelectorAll('a[href]').forEach(a => {
        const href = a.getAttribute('href');
        const text = a.textContent.trim();
        if (href && text && !href.includes('.apk') && !href.startsWith('#')) {
          links.push({ href, text });
        }
      });
      return links;
    });

    console.log(`   Found ${navLinks.length} navigation links`);

    // Step 4: Visit each category/channel page to extract stream URLs
    for (const link of navLinks) {
      try {
        let fullUrl = link.href;
        if (fullUrl.startsWith('/')) {
          fullUrl = BASE_URL + fullUrl;
        } else if (!fullUrl.startsWith('http')) {
          fullUrl = BASE_URL + '/' + fullUrl;
        }

        // Skip external links and download links
        if (!fullUrl.includes('iptvidn.com') && !fullUrl.startsWith(BASE_URL)) continue;
        if (fullUrl.includes('.apk')) continue;

        console.log(`   📺 Visiting: ${link.text} → ${fullUrl}`);
        
        await page.goto(fullUrl, {
          waitUntil: 'networkidle2',
          timeout: 20000
        }).catch(() => {});
        
        await sleep(2000);

        // Extract channels from this page
        const categoryName = link.text || 'Uncategorized';
        const pageChannels = await parseChannels(page, categoryName);

        for (const ch of pageChannels) {
          if (!seenUrls.has(ch.url)) {
            seenUrls.add(ch.url);
            allChannels.push(ch);
          }
        }

        // Also check for any sub-links (channel detail pages)
        const subLinks = await page.evaluate(() => {
          const items = [];
          document.querySelectorAll('a[href], .channel-card, .channel-item, [data-url], [data-src]').forEach(el => {
            const href = el.getAttribute('href') || el.getAttribute('data-url') || el.getAttribute('data-src') || '';
            const name = el.textContent?.trim() || el.getAttribute('title') || el.getAttribute('alt') || '';
            const logo = el.querySelector('img')?.src || '';
            if (href && (href.includes('.m3u8') || href.includes('/live/') || href.includes('/stream/'))) {
              items.push({ name, url: href, logo });
            }
          });
          return items;
        });

        for (const sub of subLinks) {
          if (sub.url && !seenUrls.has(sub.url)) {
            seenUrls.add(sub.url);
            allChannels.push({
              name: sub.name || 'Unknown',
              url: sub.url,
              logo: sub.logo || '',
              category: categoryName
            });
          }
        }

      } catch (err) {
        console.warn(`   ⚠️ Error visiting ${link.text}: ${err.message}`);
      }
    }

    // Step 5: Add any intercepted stream URLs that weren't captured via DOM
    for (const [streamUrl] of interceptedStreams) {
      if (!seenUrls.has(streamUrl)) {
        seenUrls.add(streamUrl);
        allChannels.push({
          name: extractNameFromUrl(streamUrl),
          url: streamUrl,
          logo: '',
          category: 'Discovered'
        });
      }
    }

    // Merge main page channels
    for (const ch of mainPageChannels) {
      if (ch.url && !seenUrls.has(ch.url)) {
        seenUrls.add(ch.url);
        allChannels.push(ch);
      }
    }

  } catch (err) {
    console.error('❌ Fatal scraper error:', err.message);
  } finally {
    await browser.close();
  }

  console.log(`\n✅ Total unique channels found: ${allChannels.length}`);

  // Step 6: Generate M3U8 playlist
  if (allChannels.length > 0) {
    // Ensure output directory exists
    const outputDir = path.dirname(OUTPUT_PATH);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    generatePlaylist(allChannels, OUTPUT_PATH);
    console.log(`📁 Playlist written to: ${OUTPUT_PATH}`);
  } else {
    console.log('⚠️ No channels found. Keeping existing playlist if available.');
    // Don't overwrite existing playlist if scrape returned nothing
    if (!fs.existsSync(OUTPUT_PATH)) {
      // Create a minimal placeholder
      const outputDir = path.dirname(OUTPUT_PATH);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      generatePlaylist([], OUTPUT_PATH);
    }
  }

  console.log('🏁 Scraper finished.');
  return allChannels;
}

function extractNameFromUrl(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    // Try to find a meaningful segment
    for (const part of parts) {
      if (!part.includes('.') && part !== 'live' && part !== 'stream' && part !== 'index') {
        return part.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      }
    }
    return 'Unknown Channel';
  } catch {
    return 'Unknown Channel';
  }
}

// Run the scraper
scrapeAllChannels().catch(err => {
  console.error('❌ Unhandled error:', err);
  process.exit(1);
});
