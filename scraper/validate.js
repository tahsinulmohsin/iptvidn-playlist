const fs = require('fs');
const path = require('path');

const PLAYLIST_PATH = path.join(__dirname, '..', 'public', 'playlist.m3u8');

function validate() {
  console.log('🔍 Validating playlist...');

  if (!fs.existsSync(PLAYLIST_PATH)) {
    console.error('❌ Playlist file not found:', PLAYLIST_PATH);
    process.exit(1);
  }

  const content = fs.readFileSync(PLAYLIST_PATH, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());

  if (lines.length === 0) {
    console.error('❌ Playlist file is empty');
    process.exit(1);
  }

  if (!lines[0].startsWith('#EXTM3U')) {
    console.error('❌ Invalid M3U8: Missing #EXTM3U header');
    process.exit(1);
  }

  let channelCount = 0;
  let errorCount = 0;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#EXTINF:')) {
      channelCount++;
      // Next non-comment line should be a URL
      const nextLine = lines[i + 1];
      if (!nextLine || nextLine.startsWith('#')) {
        console.warn(`⚠️ Line ${i + 1}: #EXTINF not followed by URL`);
        errorCount++;
      }
    }
  }

  console.log(`✅ Playlist is valid`);
  console.log(`   Channels: ${channelCount}`);
  if (errorCount > 0) {
    console.warn(`   Warnings: ${errorCount}`);
  }

  return { valid: true, channelCount, errorCount };
}

validate();
