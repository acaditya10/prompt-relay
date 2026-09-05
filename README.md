# prompt-relay

Send input prompts from your laptop to your phone. One-time setup, works forever.

Uses [ntfy.sh](https://ntfy.sh) — open-source push notifications. No accounts, no cloud services, no tunnel.

## Setup (one time, 2 minutes)

1. Install **ntfy** from Play Store on your Android
2. Open the app → tap **"Subscribe to topic"** → type any name (e.g. `my-prompts`)
3. Run:
   ```bash
   node index.js config
   ```
   Enter the same topic name. Done.

## Usage

```bash
# Simple notification
node index.js send "Deploy to production?"

# With choices (tappable buttons on phone)
node index.js send "Pick a database" --choices PostgreSQL,MySQL,SQLite

# Test it
node index.js test

# Listen for responses
node index.js listen
```

## How it works

```
┌──────────────┐   POST ntfy.sh   ┌──────────┐   Push    ┌──────────────┐
│  Laptop      │ ───────────────► │  ntfy    │ ────────► │  Phone       │
│  (script)    │                  │  server  │           │  (ntfy app)  │
└──────────────┘                  └──────────┘           └──────┬───────┘
                                                                │
                              User taps choice button           │
                              or types response                 │
                              ◄──────────────────────────────────┘
```

- **Sending**: Script POSTs to `ntfy.sh/topic` → phone gets instant notification
- **Responding**: Tap action buttons or type `<id>:<number>` in the ntfy app
- **Receiving**: Script polls `ntfy.sh/topic` for response messages

## Response format

When you send a prompt with choices, the phone shows action buttons. Tapping one sends a message like `abc123:1` to the topic. The script picks this up.

You can also type responses manually in the ntfy app:
```
abc123:1
```

## Files

```
prompt-relay/
├── index.js          # The entire tool (single file)
├── .config.json      # Your topic (auto-created)
└── README.md
```

## Tech

| What | Size |
|------|------|
| Laptop | Single Node.js file, 0 dependencies |
| Phone | ntfy app (~5 MB) |
| Network | ntfy.sh free tier (no account needed) |

## License

MIT
