#!/usr/bin/env bash
# One command for the demo school:
#   bash scripts/demo.sh
# Frees ports 3000/4000, updates the database, starts the app in the background
# (log in dev-log.txt), waits until it answers, then creates the demo school.
set -u
cd "$(dirname "$0")/.."

echo "▸ Stopping anything on ports 3000 and 4000"
pkill -f "turbo run dev" 2>/dev/null
for port in 3000 4000; do
  pids=$(lsof -ti tcp:$port 2>/dev/null)
  [ -n "$pids" ] && kill $pids 2>/dev/null
done
sleep 2
for port in 3000 4000; do
  pids=$(lsof -ti tcp:$port 2>/dev/null)
  [ -n "$pids" ] && kill -9 $pids 2>/dev/null
done

echo "▸ Updating the database"
pnpm -s db:setup || { echo "✖ Database update failed (see above)"; exit 1; }

echo "▸ Starting the app (log: dev-log.txt)"
nohup pnpm dev > dev-log.txt 2>&1 &

echo "▸ Waiting for the app"
ok=""
for i in $(seq 1 90); do
  for host in localhost 127.0.0.1; do
    if curl -s -o /dev/null -m 2 "http://$host:4000/api/v1/health"; then ok=1; break 2; fi
  done
  sleep 2
done
if [ -z "$ok" ]; then
  echo "✖ The app did not start. Last lines of dev-log.txt:"
  tail -20 dev-log.txt
  exit 1
fi

node scripts/seed-demo.mjs
status=$?
echo
if [ $status -eq 0 ]; then
  echo "✔ The app is running in the background. Open http://localhost:3000/login"
  echo "  Logins are in demo-logins.txt. To stop the app later: pkill -f turbo"
else
  echo "✖ Seed failed. The app is still running; its log is in dev-log.txt"
fi
