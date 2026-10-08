#!/bin/bash
export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH
while true; do
  echo "[$(date)] Starting persistent localtunnel on port 8080..."
  npx -y localtunnel --port 8080 --subdomain oc-connect-kelowna
  echo "[$(date)] Tunnel connection dropped, reconnecting in 2s..."
  sleep 2
done
