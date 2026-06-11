/**
 * DOM-based channel parser for iptvidn.com
 * Extracts channel names, logos, stream URLs, and categories from rendered pages.
 */

async function parseChannels(page, defaultCategory = 'Uncategorized') {
  const channels = await page.evaluate((category) => {
    const results = [];
    const seen = new Set();

    // Strategy 1: Look for video/source elements with stream URLs
    document.querySelectorAll('video source, video[src]').forEach(el => {
      const src = el.getAttribute('src') || el.src;
      if (src && !seen.has(src)) {
        seen.add(src);
        results.push({
          name: document.title || 'Unknown',
          url: src,
          logo: '',
          category: category
        });
      }
    });

    // Strategy 2: Look for iframe embeds (common in IPTV sites)
    document.querySelectorAll('iframe[src]').forEach(iframe => {
      const src = iframe.getAttribute('src') || iframe.src;
      if (src && (src.includes('.m3u8') || src.includes('/live/') || src.includes('/embed/'))) {
        if (!seen.has(src)) {
          seen.add(src);
          results.push({
            name: iframe.getAttribute('title') || 'Embedded Stream',
            url: src,
            logo: '',
            category: category
          });
        }
      }
    });

    // Strategy 3: Look for channel cards / grid items
    const cardSelectors = [
      '.channel-card', '.channel-item', '.card', '.grid-item',
      '.channel', '.tv-channel', '.live-channel', '.stream-item',
      '[class*="channel"]', '[class*="stream"]', '[class*="card"]'
    ];

    for (const selector of cardSelectors) {
      document.querySelectorAll(selector).forEach(card => {
        const link = card.querySelector('a[href]');
        const img = card.querySelector('img');
        const nameEl = card.querySelector('h2, h3, h4, h5, .title, .name, .channel-name, span');

        const href = link?.getAttribute('href') || '';
        const name = nameEl?.textContent?.trim() || card.textContent?.trim().substring(0, 50) || 'Unknown';
        const logo = img?.src || img?.getAttribute('data-src') || '';

        if (href && !seen.has(href)) {
          seen.add(href);
          results.push({ name, url: href, logo, category });
        }
      });
    }

    // Strategy 4: Look for all anchor tags with stream-like URLs
    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href') || '';
      if (href.includes('.m3u8') || href.includes('/live/') || href.includes('/stream/') || href.includes('/play/')) {
        if (!seen.has(href)) {
          seen.add(href);
          const name = a.textContent?.trim() || a.getAttribute('title') || 'Unknown';
          const logo = a.querySelector('img')?.src || '';
          results.push({ name, url: href, logo, category });
        }
      }
    });

    // Strategy 5: Look for data attributes that contain URLs
    document.querySelectorAll('[data-url], [data-src], [data-stream], [data-href], [data-link]').forEach(el => {
      const url = el.getAttribute('data-url') || el.getAttribute('data-src') || 
                  el.getAttribute('data-stream') || el.getAttribute('data-href') || 
                  el.getAttribute('data-link') || '';
      if (url && !seen.has(url)) {
        seen.add(url);
        results.push({
          name: el.textContent?.trim()?.substring(0, 50) || el.getAttribute('title') || 'Unknown',
          url: url,
          logo: el.querySelector('img')?.src || '',
          category: category
        });
      }
    });

    // Strategy 6: Search for inline scripts containing stream URLs
    document.querySelectorAll('script:not([src])').forEach(script => {
      const content = script.textContent || '';
      // Match m3u8 URLs in JavaScript
      const m3u8Regex = /["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)["']/g;
      let match;
      while ((match = m3u8Regex.exec(content)) !== null) {
        const url = match[1];
        if (!seen.has(url)) {
          seen.add(url);
          results.push({
            name: 'Discovered Stream',
            url: url,
            logo: '',
            category: category
          });
        }
      }

      // Match general stream URLs
      const streamRegex = /["'](https?:\/\/[^"'\s]*\/(?:live|stream)\/[^"'\s]+)["']/g;
      while ((match = streamRegex.exec(content)) !== null) {
        const url = match[1];
        if (!seen.has(url)) {
          seen.add(url);
          results.push({
            name: 'Discovered Stream',
            url: url,
            logo: '',
            category: category
          });
        }
      }
    });

    return results;
  }, defaultCategory);

  return channels;
}

module.exports = { parseChannels };
