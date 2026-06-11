module.exports = async function handler(req, res) {
  try {
    const fetch = require('node-fetch'); // Ensure node-fetch is used if native fails
    const result = { logs: [] };
    const log = (msg) => result.logs.push(msg);

    log('Testing iptvidn.com...');
    try {
      const start = Date.now();
      const r = await fetch('http://iptvidn.com', { timeout: 5000 });
      log(`iptvidn.com: ${r.status} (${Date.now() - start}ms)`);
    } catch(e) {
      log(`iptvidn.com ERROR: ${e.message}`);
    }

    log('Testing Cloudflare IP...');
    try {
      const start = Date.now();
      const r = await fetch('http://104.21.36.170', { 
        headers: { 'Host': 'iptvidn.com' },
        timeout: 5000 
      });
      log(`IP direct: ${r.status} (${Date.now() - start}ms)`);
    } catch(e) {
      log(`IP direct ERROR: ${e.message}`);
    }

    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
