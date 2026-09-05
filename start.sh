#!/bin/bash
# opencode-mobile-notify - One-command setup

set -e

echo ""
echo "  ==================================="
echo "   opencode-mobile-notify - Setup"
echo "  ==================================="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "  [ERROR] Node.js not found."
    echo "  Download from: https://nodejs.org/"
    exit 1
fi

echo "  Node.js: $(node -v)"
echo "  npm:     $(npm -v)"
echo ""

# Install dependencies
echo "  [1/4] Installing dependencies..."
cd "$(dirname "$0")/server"
npm install --silent

# Generate icons
echo "  [2/4] Generating icons..."
node generate-icons.js

# Start server in background
echo "  [3/4] Starting server..."
node index.js &
SERVER_PID=$!

# Wait for server
sleep 2

# Start ngrok or fallback to local
if command -v ngrok &> /dev/null; then
    echo "  [4/4] Starting ngrok tunnel..."
    echo ""
    echo "  ==================================="
    echo "   Your PWA URL (open on phone):"
    echo "  ==================================="
    echo ""
    ngrok http 3077
else
    echo ""
    echo "  [!] ngrok not found."
    echo "  Install: https://ngrok.com/download"
    echo ""
    echo "  Starting server on local only:"
    echo "    http://localhost:3077"
    echo ""
    echo "  Press Ctrl+C to stop."
    wait $SERVER_PID
fi
