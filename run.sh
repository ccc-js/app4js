#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Cleaning up old processes ==="
lsof -ti:3000 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 1

echo "=== Starting box4 sync ==="
cd "$SCRIPT_DIR/box4"
mkdir -p test_server_data test_client_data
node server.js 3000 test_server_data &
SERVER_PID=$!
node client.js ws://localhost:3000 test_client_data &
CLIENT_PID=$!
sleep 2

echo "=== Starting agent4 ==="
cd "$SCRIPT_DIR/agent4"
npm install --silent
npm run rebuild --silent
npm start

echo "=== Cleaning up ==="
kill $SERVER_PID $CLIENT_PID 2>/dev/null
wait