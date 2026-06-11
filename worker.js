const express = require('express');
const { execSync } = require('child_process');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Simple web server to satisfy Cloud Health Checks
app.get('/', (req, res) => {
  res.send(`🚀 IPTVIDN Auto-Updater is running! Last run: ${global.lastRun || 'Never'}`);
});

app.get('/trigger', (req, res) => {
  runUpdater();
  res.send('Manual update triggered!');
});

app.listen(PORT, () => {
  console.log(`🌐 Web server listening on port ${PORT}`);
  
  // Run immediately on start
  runUpdater();
  
  // Run every 20 minutes (20 * 60 * 1000)
  setInterval(runUpdater, 20 * 60 * 1000);
});

function runUpdater() {
  console.log(`\n[${new Date().toISOString()}] 🔄 Starting Auto-Update...`);
  global.lastRun = new Date().toISOString();
  
  try {
    // 1. Generate the static M3U8
    execSync('node scraper/generate_static.js', { stdio: 'inherit' });

    // 2. Setup Git (needed for cloud containers)
    if (process.env.GITHUB_TOKEN) {
      execSync('git config --global user.email "bot@antigravity.local"');
      execSync('git config --global user.name "IPTVIDN Bot"');
      const remoteUrl = `https://oauth2:${process.env.GITHUB_TOKEN}@github.com/tahsinulmohsin/iptvidn-playlist.git`;
      execSync(`git remote set-url origin ${remoteUrl}`);
    } else {
      console.warn('⚠️ GITHUB_TOKEN environment variable not set. Push might fail if authentication is required.');
    }

    // 3. Commit and push to GitHub
    console.log(`[${new Date().toISOString()}] Committing to GitHub...`);
    execSync('git add public/playlist.m3u8', { stdio: 'inherit' });
    
    const status = execSync('git status --porcelain').toString();
    if (status.includes('public/playlist.m3u8')) {
      execSync('git commit -m "🔄 Auto-update playlist (every 20 mins) [skip ci]"', { stdio: 'inherit' });
      execSync('git push origin main', { stdio: 'inherit' });
      console.log(`[${new Date().toISOString()}] ✅ Successfully pushed updated playlist to GitHub!`);
    } else {
      console.log(`[${new Date().toISOString()}] ⏭️ No changes to playlist. Skipping push.`);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Error during auto-update:`, error.message);
  }
}
