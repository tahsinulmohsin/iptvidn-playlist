const { execSync } = require('child_process');
const path = require('path');

// Run the static generator
console.log(`[${new Date().toISOString()}] Starting auto-updater...`);

try {
  // 1. Generate the static M3U8
  execSync('node scraper/generate_static.js', { stdio: 'inherit' });

  // 2. Commit and push to GitHub
  console.log(`[${new Date().toISOString()}] Committing to GitHub...`);
  execSync('git add public/playlist.m3u8', { stdio: 'inherit' });
  
  // Check if there are changes
  const status = execSync('git status --porcelain').toString();
  if (status.includes('public/playlist.m3u8')) {
    execSync('git commit -m "🔄 Auto-update playlist (every 20 mins)"', { stdio: 'inherit' });
    execSync('git push origin main', { stdio: 'inherit' });
    console.log(`[${new Date().toISOString()}] ✅ Successfully pushed updated playlist to GitHub. Vercel will now deploy it.`);
  } else {
    console.log(`[${new Date().toISOString()}] ⏭️ No changes to playlist. Skipping push.`);
  }
} catch (error) {
  console.error(`[${new Date().toISOString()}] ❌ Error during auto-update:`, error.message);
}
