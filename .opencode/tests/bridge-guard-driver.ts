/**
 * bridge-guard-driver — subprocess driver for the soren-bridge test harness.
 *
 * The plugin captures SOREN_* env at module load, so each guard scenario runs
 * in a fresh `bun` process with its own environment. This driver instantiates
 * the plugin, fires `tool.execute.before` once, and prints the outcome:
 *
 *   ALLOWED             — the hook did not throw
 *   BLOCKED: <message>  — the hook threw (write guard fired)
 *   NOHOOK              — plugin inactive (no hooks returned)
 *
 * Usage: bun bridge-guard-driver.ts <tool> <filePath-or-command>
 */
import { SorenBridge } from "../plugins/soren-bridge"

const tool = process.argv[2] ?? "edit"
const arg = process.argv[3] ?? ""

const hooks = await SorenBridge({
  directory: process.env.DRIVER_DIRECTORY ?? process.cwd(),
} as any)

const before = (hooks as any)["tool.execute.before"]
if (!before) {
  console.log("NOHOOK")
  process.exit(0)
}

const args = tool === "bash" ? { command: arg } : { filePath: arg }
try {
  await before({ tool, sessionID: "test-session", args }, { args })
  console.log("ALLOWED")
} catch (e) {
  console.log(`BLOCKED: ${(e as Error).message}`)
}
