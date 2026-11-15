// Runs before `pnpm dev`: stops any old web (3000) or API (4000) server still
// running in the background, so the new one can start. macOS / Linux only.
import { execSync } from 'node:child_process';

for (const port of [3000, 4000]) {
  let pids = '';
  try {
    pids = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: 'utf8' }).trim();
  } catch {
    continue; // nothing on this port
  }
  for (const pid of pids.split('\n').filter(Boolean)) {
    try {
      process.kill(Number(pid), 'SIGTERM');
      console.log(`Stopped old server on port ${port} (pid ${pid})`);
    } catch {
      /* already gone */
    }
  }
}
await new Promise((r) => setTimeout(r, 800));
