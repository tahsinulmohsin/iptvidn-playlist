const fs = require('fs');

/**
 * Generates a valid M3U8 playlist file from channel data.
 *
 * @param {Array} channels - Array of { name, url, logo, category }
 * @param {string} outputPath - Path to write the .m3u8 file
 */
function generatePlaylist(channels, outputPath) {
  const timestamp = new Date().toISOString();
  const lines = [];

  // M3U8 header
  lines.push('#EXTM3U');
  lines.push(`# IPTVIDN Playlist — Auto-generated`);
  lines.push(`# Last updated: ${timestamp}`);
  lines.push(`# Total channels: ${channels.length}`);
  lines.push(`# Source: http://iptvidn.com`);
  lines.push(`# GitHub: https://github.com/YOUR_USERNAME/iptvidn-playlist`);
  lines.push('');

  // Sort channels by category, then by name
  const sorted = [...channels].sort((a, b) => {
    const catCompare = (a.category || '').localeCompare(b.category || '');
    if (catCompare !== 0) return catCompare;
    return (a.name || '').localeCompare(b.name || '');
  });

  for (const channel of sorted) {
    // Clean up channel name
    const name = (channel.name || 'Unknown').trim().replace(/\s+/g, ' ');
    const logo = (channel.logo || '').trim();
    const category = (channel.category || 'Uncategorized').trim();
    let url = (channel.url || '').trim();

    // Skip invalid entries
    if (!url || url === '#' || url === '/') continue;

    // Build EXTINF line with metadata
    let extinf = `#EXTINF:-1`;
    extinf += ` tvg-name="${escapeQuotes(name)}"`;
    if (logo) {
      extinf += ` tvg-logo="${escapeQuotes(logo)}"`;
    }
    extinf += ` group-title="${escapeQuotes(category)}"`;
    extinf += `,${name}`;

    lines.push(extinf);
    lines.push(url);
  }

  const content = lines.join('\n') + '\n';
  fs.writeFileSync(outputPath, content, 'utf-8');

  console.log(`📝 Generated playlist with ${channels.length} channels`);
  console.log(`   Categories: ${[...new Set(channels.map(c => c.category))].join(', ')}`);
}

function escapeQuotes(str) {
  return str.replace(/"/g, "'");
}

module.exports = { generatePlaylist };
