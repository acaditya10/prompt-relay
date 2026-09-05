# prompt-relay

Send opencode permission prompts to your phone. Respond with a tap.

## Setup (one time)

1. Install **ntfy** on Android → subscribe to a topic (e.g. `opencode-input`)
2. Run: `node index.js config` → enter your topic name
3. Done.

## Quick usage (custom scripts)

```bash
node index.js send "Deploy?" --choices Yes,No
```

## opencode bridge (respond to permission prompts from phone)

This sends opencode's "Allow / Deny" prompts to your phone as notifications with tappable buttons.

### Prerequisites

- opencode with server enabled (already configured in your global config)
- ntfy app on phone

### Run

```bash
# Terminal 1: Start opencode (server mode)
opencode

# Terminal 2: Start the bridge
node bridge.js
```

When opencode asks for permission (e.g. `external_directory`), you'll get a notification on your phone with:
- ✅ Allow once
- 🔓 Allow always
- ❌ Deny

Tap a button — it auto-responds in opencode.

### How it works

```
opencode (server)  ←SSE→  bridge.js  ←POST→  ntfy.sh  ←push→  Phone
                         bridge.js  ←poll←   ntfy.sh  ←tap──   Phone
```

1. Bridge listens to opencode's event stream (SSE)
2. When permission is asked → sends ntfy notification with buttons
3. User taps button → ntfy sends response to bridge
4. Bridge calls opencode's SDK endpoint to approve/deny

## Files

```
prompt-relay/
├── index.js      # Simple ntfy sender (custom scripts)
├── bridge.js     # opencode ↔ ntfy bridge (permission prompts)
└── README.md
```

## License

MIT
