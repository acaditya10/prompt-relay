# prompt-relay

A lightweight self-hosted notification bridge. When a CLI tool or script on your laptop needs human input, it pushes a notification to your phone. You respond from your phone — choices or free text — and the response flows back to the script instantly.

**Zero cloud services. No Firebase. No accounts. Your laptop is the server.**

## How it works

```
┌──────────────┐     HTTP POST    ┌──────────────┐    WebSocket    ┌──────────────┐
│  CLI tool /  │ ───────────────► │  Node.js     │ ◄───────────── │  Phone PWA   │
│  script      │   /api/prompt    │  (laptop)    │  real-time     │  (browser)   │
└──────────────┘                  └──────┬───────┘                 └──────────────┘
                                         │ ngrok (free tunnel)
                                    ┌────▼─────┐
                                    │ Internet  │
                                    └──────────┘
```

1. Your script sends a POST request to the server
2. Server pushes it to the connected PWA via WebSocket
3. PWA shows a native notification (even when backgrounded)
4. User taps, responds, response goes back to the server
5. Script polls for the response and continues

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [ngrok](https://ngrok.com/download) (free, for internet access)

### One Command Setup

**Windows:**
```bash
start.bat
```

**Linux / macOS:**
```bash
chmod +x start.sh
./start.sh
```

This will:
1. Install npm dependencies
2. Generate PWA icons
3. Start the server on port 3077
4. Start ngrok tunnel
5. Print your PWA URL

### Manual Setup

```bash
cd server
npm install
node generate-icons.js
node index.js
```

In another terminal:
```bash
ngrok http 3077
```

## Phone Setup (one-time)

1. Open the ngrok URL in Chrome on your Android phone
2. Tap **"Add to Home Screen"** when prompted (or use Chrome menu > "Install app")
3. Grant notification permission when asked
4. Done — the app will receive prompts even when closed

## Sending Prompts

### From CLI

```bash
# Simple yes/no
node trigger.js "Do you want to continue?"

# Multiple choice
node trigger.js "Pick a database" --choices "PostgreSQL,MySQL,SQLite"

# Free text input
node trigger.js "Enter the API key" --type text

# With timeout (10 seconds)
node trigger.js "Quick! Pick one" --choices "Yes,No" --timeout 10000
```

### From Code (Node.js)

```javascript
const { sendPrompt, pollResponse } = require('./trigger');

async function main() {
  // Send a choice prompt
  const result = await sendPrompt('Deploy to production?', {
    choices: ['Yes, deploy', 'No, cancel']
  });

  console.log(`Prompt sent: ${result.id}`);

  // Wait for response
  const response = await pollResponse(result.id);
  console.log(`User said: ${response}`);
}
```

### Via HTTP API

```bash
# Send a prompt
curl -X POST http://localhost:3077/api/prompt \
  -H "Content-Type: application/json" \
  -d '{"message": "Approve this change?", "choices": ["Yes", "No"]}'

# Response: { "id": "abc-123", "status": "sent" }

# Poll for response
curl http://localhost:3077/api/prompt/abc-123

# Response when pending: { "status": "pending" }
# Response when answered: { "status": "completed", "response": "Yes" }
```

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/prompt` | Send a prompt to the phone |
| `GET` | `/api/prompt/:id` | Poll for a response |
| `GET` | `/api/prompts` | List all pending prompts |
| `DELETE` | `/api/prompt/:id` | Cancel a prompt |
| `GET` | `/api/status` | Server health check |

### POST /api/prompt

```json
{
  "message": "string (required)",
  "choices": ["option1", "option2"],
  "type": "choice | text",
  "timeout": 300000,
  "meta": {}
}
```

## Architecture

```
opencode-mobile-notify/
├── server/
│   ├── index.js            # Express + Socket.IO server
│   ├── trigger.js          # CLI trigger script
│   ├── generate-icons.js   # PWA icon generator
│   ├── package.json
│   └── public/
│       ├── index.html      # PWA shell
│       ├── style.css       # Dark theme UI
│       ├── app.js          # Client logic
│       ├── sw.js           # Service worker
│       ├── manifest.json   # PWA manifest
│       ├── icon-192.png    # App icon
│       └── icon-512.png    # App icon (splash)
├── start.bat               # Windows one-click setup
├── start.sh                # Linux/macOS one-click setup
└── README.md
```

## Tech Stack

| Component | Technology | Size |
|-----------|-----------|------|
| Server | Node.js + Express + Socket.IO | ~2 MB |
| PWA | Vanilla HTML/CSS/JS | ~10 KB |
| Service Worker | Cache API + Notification API | ~2 KB |
| Tunnel | ngrok (free tier) | — |

**Total: ~2 MB on laptop, ~50 KB cached on phone**

## Resource Usage

| Resource | Phone Usage |
|----------|-------------|
| Storage | ~50 KB (cached PWA assets) |
| RAM | ~10-30 MB (when active) |
| Battery | Negligible (WebSocket, no polling) |
| Background | Service worker only (~1 MB) |

## Troubleshooting

**"No mobile clients connected"**
- Open the PWA on your phone
- Check that the WebSocket connection shows "Connected"

**Notifications not showing**
- Make sure you granted notification permission
- On Android: Settings > Apps > oc-notify > Notifications > ON
- Make sure the PWA is installed (not just opened as a URL)

**ngrok URL changed**
- Free ngrok restarts every few hours
- Just update the URL on your phone, or re-open it

**Server unreachable from phone**
- Make sure both devices are on the internet
- ngrok handles NAT traversal automatically
- Check firewall isn't blocking port 3077

## License

MIT
