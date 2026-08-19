/**
 * soren-bridge test harness — exercises the plugin's structural write guards.
 *
 * Run with:  bun test .opencode/tests/
 *
 * The plugin reads SOREN_* env at module load, so every scenario spawns the
 * plugin in a fresh bun subprocess (bridge-guard-driver.ts) with a synthetic
 * SOREN_HOME/worktree layout under a temp dir. Covers:
 *   - uniform policy: worktree jail, protected live paths, worktree writes OK
 *   - contract policy: protected_paths "forbidden" blocks even in a worktree
 *   - fail-open: missing/corrupt contracts.json falls back to uniform policy
 *   - SOREN_PROTECTED_OVERRIDE=1 bypasses everything
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const DRIVER = join(import.meta.dir, "bridge-guard-driver.ts")

let HOME_DIR: string // synthetic SOREN_HOME (live checkout)
let WT: string // synthetic worktree
const CONTRACTS = () => join(HOME_DIR, ".soren", "run", "contracts.json")

const VALID_CONTRACTS = {
  "perm-backend": {
    tier: "opus",
    category: "builder",
    worktree_required: true,
    protected_paths: "forbidden",
    done_requires_commit: true,
    domains: ["backend"],
  },
  "perm-infra": {
    tier: "opus",
    category: "builder",
    worktree_required: true,
    protected_paths: "via-worktree",
    done_requires_commit: true,
    domains: ["infra"],
  },
}

beforeAll(() => {
  HOME_DIR = mkdtempSync(join(tmpdir(), "soren-bridge-home-"))
  WT = mkdtempSync(join(tmpdir(), "soren-bridge-wt-"))
  mkdirSync(join(HOME_DIR, ".soren", "run"), { recursive: true })
})

afterAll(() => {
  rmSync(HOME_DIR, { recursive: true, force: true })
  rmSync(WT, { recursive: true, force: true })
})

function writeContracts(content: string) {
  writeFileSync(CONTRACTS(), content)
}

function removeContracts() {
  rmSync(CONTRACTS(), { force: true })
}

type GuardOpts = {
  agent: string
  tool?: string
  path: string
  worktree?: string | null
  override?: boolean
}

/** Run one guard scenario in a fresh plugin process; returns stdout line. */
function runGuard(opts: GuardOpts): string {
  const env: Record<string, string> = {
    ...process.env,
    SOREN_AGENT: "true",
    SOREN_AGENT_NAME: opts.agent,
    SOREN_HOME: HOME_DIR,
    DRIVER_DIRECTORY: opts.worktree ?? HOME_DIR,
  }
  delete env.SOREN_WORKTREE
  delete env.SOREN_PROTECTED_OVERRIDE
  if (opts.worktree) env.SOREN_WORKTREE = opts.worktree
  if (opts.override) env.SOREN_PROTECTED_OVERRIDE = "1"

  const proc = Bun.spawnSync(["bun", DRIVER, opts.tool ?? "edit", opts.path], {
    env,
    cwd: import.meta.dir,
  })
  const out = proc.stdout.toString().trim()
  if (proc.exitCode !== 0) {
    throw new Error(`driver exited ${proc.exitCode}: ${proc.stderr.toString()}`)
  }
  return out
}

describe("uniform policy (no contract entry)", () => {
  test("worktree jail: write to live checkout is blocked", () => {
    writeContracts(JSON.stringify(VALID_CONTRACTS))
    const out = runGuard({ agent: "perm-frontend", path: `${HOME_DIR}/src/server/main.py`, worktree: WT })
    expect(out).toStartWith("BLOCKED:")
    expect(out).toContain("Worktree isolation")
  })

  test("protected live path blocked for agent without worktree", () => {
    writeContracts(JSON.stringify(VALID_CONTRACTS))
    const out = runGuard({ agent: "feature-x", path: `${HOME_DIR}/soren.sh`, worktree: null })
    expect(out).toStartWith("BLOCKED:")
    expect(out).toContain("Protected path")
  })

  test("agent absent from contracts.json may edit protected paths inside its worktree", () => {
    writeContracts(JSON.stringify(VALID_CONTRACTS))
    const out = runGuard({ agent: "perm-frontend", path: `${WT}/soren.sh`, worktree: WT })
    expect(out).toBe("ALLOWED")
  })

  test("contract with protected_paths via-worktree keeps worktree edits allowed", () => {
    writeContracts(JSON.stringify(VALID_CONTRACTS))
    const out = runGuard({ agent: "perm-infra", path: `${WT}/src/orchestrator/monitor.sh`, worktree: WT })
    expect(out).toBe("ALLOWED")
  })
})

describe("contract policy (protected_paths: forbidden)", () => {
  test("blocked from editing a protected path even inside its worktree", () => {
    writeContracts(JSON.stringify(VALID_CONTRACTS))
    const out = runGuard({ agent: "perm-backend", path: `${WT}/soren.sh`, worktree: WT })
    expect(out).toStartWith("BLOCKED:")
    expect(out).toContain("Contract rule violated (protected_paths: forbidden)")
    expect(out).toContain("perm-backend")
  })

  test("blocked on protected subtree paths in the worktree", () => {
    writeContracts(JSON.stringify(VALID_CONTRACTS))
    const out = runGuard({
      agent: "perm-backend",
      path: `${WT}/.opencode/plugins/soren-bridge.ts`,
      worktree: WT,
    })
    expect(out).toStartWith("BLOCKED:")
    expect(out).toContain("Contract rule violated")
  })

  test("non-protected worktree paths remain editable", () => {
    writeContracts(JSON.stringify(VALID_CONTRACTS))
    const out = runGuard({ agent: "perm-backend", path: `${WT}/src/server/main.py`, worktree: WT })
    expect(out).toBe("ALLOWED")
  })

  test("bash write-shaped command on protected path loses the worktree exemption", () => {
    writeContracts(JSON.stringify(VALID_CONTRACTS))
    const out = runGuard({
      agent: "perm-backend",
      tool: "bash",
      path: "sed -i '' 's/a/b/' src/orchestrator/monitor.sh",
      worktree: WT,
    })
    expect(out).toStartWith("BLOCKED:")
    expect(out).toContain("Contract rule violated")
  })

  test("SOREN_PROTECTED_OVERRIDE=1 still bypasses the contract rule", () => {
    writeContracts(JSON.stringify(VALID_CONTRACTS))
    const out = runGuard({ agent: "perm-backend", path: `${WT}/soren.sh`, worktree: WT, override: true })
    expect(out).toBe("ALLOWED")
  })
})

describe("fail-open on bad contracts.json", () => {
  test("corrupt contracts.json → uniform policy, no crash", () => {
    writeContracts("{{{ this is not json")
    const out = runGuard({ agent: "perm-backend", path: `${WT}/soren.sh`, worktree: WT })
    expect(out).toBe("ALLOWED") // uniform policy allows protected paths in a worktree
  })

  test("contracts.json that is valid JSON but not an object → uniform policy", () => {
    writeContracts('["not", "an", "object"]')
    const out = runGuard({ agent: "perm-backend", path: `${WT}/soren.sh`, worktree: WT })
    expect(out).toBe("ALLOWED")
  })

  test("missing contracts.json → uniform policy, no crash", () => {
    removeContracts()
    const out = runGuard({ agent: "perm-backend", path: `${WT}/soren.sh`, worktree: WT })
    expect(out).toBe("ALLOWED")
    // live checkout is still jailed even with no contracts file
    const live = runGuard({ agent: "perm-backend", path: `${HOME_DIR}/soren.sh`, worktree: WT })
    expect(live).toStartWith("BLOCKED:")
  })
})
