/**
 * opencode-trigger.js
 * 
 * Call this from opencode to send a prompt to the mobile app.
 * 
 * Usage:
 *   node trigger.js "Do you want to continue?"
 *   node trigger.js "Pick an option" --choices "Yes,No,Maybe"
 *   node trigger.js "Enter the API key" --type text
 *   node trigger.js "Confirm deletion" --choices "Delete,Cancel" --timeout 60000
 * 
 * Environment:
 *   NOTIFY_SERVER  - Server URL (default: http://localhost:3077)
 */

const http = require('http');

const SERVER = process.env.NOTIFY_SERVER || 'http://localhost:3077';

function sendPrompt(message, options = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      message,
      choices: options.choices || null,
      type: options.type || (options.choices ? 'choice' : 'text'),
      timeout: options.timeout || 300000,
      meta: options.meta || null
    });

    const url = new URL('/api/prompt', SERVER);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Invalid response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function pollResponse(promptId, interval = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setInterval(async () => {
      try {
        const url = new URL(`/api/prompt/${promptId}`, SERVER);
        const data = await new Promise((res, rej) => {
          http.get(url.href, (resp) => {
            let d = '';
            resp.on('data', (c) => d += c);
            resp.on('end', () => res(JSON.parse(d)));
          }).on('error', rej);
        });

        if (data.status === 'completed') {
          clearInterval(timer);
          resolve(data.response);
        }
      } catch (e) {
        // Ignore polling errors, keep trying
      }
    }, interval);

    // Timeout after configured time
    setTimeout(() => {
      clearInterval(timer);
      reject(new Error('Prompt timed out'));
    }, options.timeout || 300000);
  });
}

// CLI mode
if (require.main === module) {
  const args = process.argv.slice(2);
  const message = args[0];

  if (!message) {
    console.error('Usage: node trigger.js "message" [--choices "a,b,c"] [--type text] [--timeout ms]');
    process.exit(1);
  }

  const flags = {};
  for (let i = 1; i < args.length; i += 2) {
    if (args[i] === '--choices') flags.choices = args[i + 1]?.split(',');
    if (args[i] === '--type') flags.type = args[i + 1];
    if (args[i] === '--timeout') flags.timeout = parseInt(args[i + 1]);
  }

  console.log(`Sending: "${message}"`);
  sendPrompt(message, flags)
    .then((res) => {
      if (res.error) {
        console.error(`Error: ${res.error}`);
        process.exit(1);
      }
      console.log(`Prompt sent (id: ${res.id})`);
      console.log('Waiting for response...');
      return pollResponse(res.id, 2000);
    })
    .then((response) => {
      console.log(`\nResponse: ${response}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(`Failed: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { sendPrompt, pollResponse };
