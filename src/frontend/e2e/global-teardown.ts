import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** Removes the disposable account created in global-setup.ts. */
const TEST_USERNAME = 'dev-verify-e2e';

function repoRoot(): string {
  return path.resolve(import.meta.dirname, '../../..');
}

export default async function globalTeardown() {
  try {
    execFileSync('./tools/auth', ['remove-user', TEST_USERNAME], {
      cwd: repoRoot(),
      stdio: 'pipe',
    });
  } catch {
    // Best-effort cleanup — don't fail the whole test run over this.
  }
}
