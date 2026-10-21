import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

// ZORK_SKIP_BUILD=1 reuses the existing dist/ (for running the unit specs alone).
export default function setup(): void {
  if (process.env.ZORK_SKIP_BUILD) return;
  const root = join(__dirname, '..');
  execFileSync('npx', ['astro', 'build'], { cwd: root, stdio: 'pipe', env: { ...process.env, ZORK_BASE: '/zork-ai/' } });
}
