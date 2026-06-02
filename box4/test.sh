#!/bin/bash
set -x

# Clean up on exit
trap "kill 0; rm -rf test_server_data test_client_data" EXIT

rm -rf test_server_data test_client_data
mkdir test_server_data test_client_data

# Start server
node server.js 3001 test_server_data &
SERVER_PID=$!
sleep 1

# Start client
node client.js ws://localhost:3001 test_client_data &
CLIENT_PID=$!
sleep 2

# Test: Create a file on client side
echo "hello from client" > test_client_data/hello.txt
sleep 1

if [ -f test_server_data/hello.txt ]; then
  echo "PASS: File synced client -> server"
  cat test_server_data/hello.txt
else
  echo "FAIL: File not synced to server"
fi

# Test: Create a file on server side
echo "hello from server" > test_server_data/world.txt
sleep 1

if [ -f test_client_data/world.txt ]; then
  echo "PASS: File synced server -> client"
  cat test_client_data/world.txt
else
  echo "FAIL: File not synced to client"
fi

# Test: Delete on client
rm test_client_data/hello.txt
sleep 1

if [ ! -f test_server_data/hello.txt ]; then
  echo "PASS: Delete synced client -> server"
else
  echo "FAIL: Delete not synced to server"
fi

# Test: Nested directory
mkdir -p test_client_data/sub/deep
echo "nested" > test_client_data/sub/deep/file.txt
sleep 1

if [ -f test_server_data/sub/deep/file.txt ]; then
  echo "PASS: Nested dir/file synced"
else
  echo "FAIL: Nested dir/file not synced"
fi

echo "All tests done"
kill 0