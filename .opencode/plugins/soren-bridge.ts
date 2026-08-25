/**
 * soren-bridge — opencode plugin that connects SOREN agents to the SOREN server.
 *
 * Replaces the Claude Code hook suite (.claude/hooks/*):
 *   notify-start.sh           -> chat.message hook            (UserPromptSubmit)
 *   notify-output.sh          -> tool.execute.after           (PostToolUse)
 *   notify-complete.sh        -> event: session.idle          (Stop + usage)
 *   stream-thought.sh         -> event: message.part.updated  (reasoning parts)
 *   stream-result.sh          -> tool.execute.after           (tool_result thought)
 *   audit-log.sh              -> tool.execute.after           (.soren/audit.log)
 *   heartbeat (inline)        -> tool.execute.after           (.soren/.*-heartbeat)
 *   block-supervisor-edits.sh -> tool.execute.before          (throw to block)
 *   block-interactive.sh      -> n/a (opencode has no AskUserQuestion/EnterPlanMode)
 *   stop-gate.sh              -> event: session.idle          (one-shot nudge)
 *   verify-done.sh            -> tool.execute.after (bash)    (spawns .opencode/hooks/verify-done.sh)
 *   verify-ui-check.sh        -> tool.execute.after (bash)    (spawns .opencode/hooks/verify-ui-check.sh)
 *
 * Only active when SOREN_AGENT=true in the environment (i.e. inside a SOREN
 * tmux window). A human running `opencode` in this repo gets no side effects.
 */
import type { Plugin } from "@opencode-ai/plugin"
import { appendFile } from "node:fs/promises"
import { readFileSync, statSync } from "node:fs"

const env = process.env
const ACTIVE = env.SOREN_AGENT === "true" && !!env.SOREN_AGENT_NAME
const AGENT = env.SOREN_AGENT_NAME ?? "unknown"
const SOREN_HOME = env.SOREN_HOME ?? process.cwd()
const API = `http://localhost:${env.SOREN_PORT ?? "8000"}`
const EVENTS_URL = env.SOREN_WEBHOOK_URL ?? `${API}/api/agent-events`
const THOUGHTS_URL = env.SOREN_THOUGHTS_URL ?? `${API}/api/thoughts`

const isSupervisor = AGENT === "supervisor" || AGENT.startsWith("sup-") || AGENT.startsWith("supervisor-")
const isPermanent = AGENT.startsWith("perm-")

// Structural write-guard configuration
const WORKTREE = (env.SOREN_WORKTREE ?? "").replace(/\/$/, "")
const OVERRIDE = env.SOREN_PROTECTED_OVERRIDE === "1"
/** Recovery-critical paths, relative to SOREN_HOME. Trailing slash = subtree. */
const PROTECTED_PATHS = [
  "src/orchestrator/",
  ".opencode/plugins/",
  ".opencode/hooks/",
  "tools/lib/opencode.sh",
  "soren.sh",
]

let cwdForResolve = SOREN_HOME // refined with the plugin's directory at init

// ── Per-agent role contracts (compiled by `tools/contract compile`) ─────────
// .soren/run/contracts.json is the runtime source of truth for role policy.
// Loaded lazily with mtime-based cache invalidation. A missing or unparseable
// file fails OPEN: agents fall back to the uniform policy (never crash).
const CONTRACTS_PATH = `${SOREN_HOME}/.soren/run/contracts.json`
type RoleContract = { protected_paths?: string; [k: string]: unknown }
let contractsCache: { mtimeMs: number; data: Record<string, RoleContract> | null } | null = null

function loadContracts(): Record<string, RoleContract> | null {
  try {
    const st = statSync(CONTRACTS_PATH)
    if (contractsCache && contractsCache.mtimeMs === st.mtimeMs) return contractsCache.data
    const parsed = JSON.parse(readFileSync(CONTRACTS_PATH, "utf8"))
    const data =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, RoleContract>)
        : null
    contractsCache = { mtimeMs: st.mtimeMs, data }
    return data
  } catch {
    contractsCache = null
    return null
  }
}

/** True when this agent's compiled contract says protected_paths: "forbidden". */
function contractForbidsProtected(): boolean {
  const contracts = loadContracts()
  if (!contracts) return false
  const c = contracts[AGENT]
  return !!c && typeof c === "object" && c.protected_paths === "forbidden"
}

/** Path is a protected path inside this agent's worktree copy. */
function isProtectedWorktreePath(abs: string): boolean {
  if (!WORKTREE || !abs.startsWith(WORKTREE + "/")) return false
  const rel = abs.slice(WORKTREE.length + 1)
  return PROTECTED_PATHS.some((p) => (p.endsWith("/") ? rel.startsWith(p) : rel === p))
}

function resolvePath(p: string): string {
  if (!p) return ""
  if (p.startsWith("/")) return p
  if (p.startsWith("~/")) return `${env.HOME ?? ""}/${p.slice(2)}`
  return `${cwdForResolve}/${p}`.replace(/\/\.\//g, "/")
}

function insideLiveCheckout(abs: string): boolean {
  if (!abs.startsWith(SOREN_HOME + "/") && abs !== SOREN_HOME) return false
  // The runtime dir is not "the checkout" — journals, mailbox, contexts live there
  if (abs.startsWith(`${SOREN_HOME}/.soren/`)) return false
  if (WORKTREE && (abs === WORKTREE || abs.startsWith(WORKTREE + "/"))) return false
  return true
}

function relToHome(abs: string): string {
  return abs.startsWith(SOREN_HOME + "/") ? abs.slice(SOREN_HOME.length + 1) : abs
}

function isProtectedLivePath(abs: string): boolean {
  if (!insideLiveCheckout(abs)) return false
  const rel = relToHome(abs)
  return PROTECTED_PATHS.some((p) => (p.endsWith("/") ? rel.startsWith(p) : rel === p))
}

function truncate(s: unknown, n: number): string {
  const str = typeof s === "string" ? s : JSON.stringify(s ?? "")
  return str.length > n ? str.slice(0, n) + "…" : str
}

/**
 * POST to the SOREN server. Never throws — a down/unreachable server must
 * never break the agent over telemetry — but unlike the original version,
 * failures are no longer completely silent: a non-2xx response or network
 * error is logged to stderr (visible in the agent's own terminal output /
 * tmux pane capture / audit trail), and callers can opt into a couple of
 * retries with short backoff for events where losing the message entirely
 * would be worse than the extra latency (e.g. the once-per-turn Stop event,
 * as opposed to the once-per-tool-call PostToolUse event).
 *
 * Returns true if the POST was accepted (2xx), false otherwise — most
 * callers still ignore the return value (fire-and-forget is correct for
 * telemetry), but the Stop-event path uses it to decide whether to fall
 * back to a placeholder message.
 */
async function post(url: string, body: unknown, opts: { retries?: number } = {}): Promise<boolean> {
  const maxAttempts = 1 + (opts.retries ?? 0)
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(4000),
      })
      if (res.ok) return true
      console.error(`[soren-bridge] POST ${url} -> HTTP ${res.status} (attempt ${attempt}/${maxAttempts})`)
    } catch (err) {
      // SOREN server may be down; never break the agent over telemetry —
      // but do log it, since this used to vanish with zero trace anywhere.
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[soren-bridge] POST ${url} failed (attempt ${attempt}/${maxAttempts}): ${msg}`)
    }
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 500 * attempt))
    }
  }
  return false
}

async function touchHeartbeat(): Promise<void> {
  const now = `${Math.floor(Date.now() / 1000)}\n`
  try {
    if (AGENT === "supervisor") {
      await Bun.write(`${SOREN_HOME}/.soren/.supervisor-heartbeat`, now)
    } else if (env.SOREN_AGENT_ROLE === "project-supervisor") {
      await Bun.write(`${SOREN_HOME}/.soren/.${AGENT}-heartbeat`, now)
    }
  } catch {}
}

async function auditLog(tool: string, args: unknown, sessionID: string): Promise<void> {
  try {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      agent_name: AGENT,
      tool_name: tool,
      input_summary: truncate(args, 200),
      session: sessionID,
    })
    await appendFile(`${SOREN_HOME}/.soren/audit.log`, line + "\n")
  } catch {}
}

/** Spawn a legacy verification hook with Claude-hook-compatible stdin JSON. */
function spawnHook(script: string, payload: unknown): void {
  try {
    const proc = Bun.spawn(["bash", `${SOREN_HOME}/.opencode/hooks/${script}`], {
      stdin: new TextEncoder().encode(JSON.stringify(payload)),
      stdout: "ignore",
      stderr: "ignore",
      env: { ...env },
      cwd: SOREN_HOME,
    })
    void proc.exited.catch(() => {})
  } catch {}
}

type MessageEnvelope = {
  info?: {
    id?: string
    role?: string
    parentID?: string
    tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } }
  }
  parts?: Array<{ type?: string; text?: string; tool?: string; state?: { input?: any; output?: string } }>
}

export const SorenBridge: Plugin = async ({ serverUrl, directory }) => {
  if (!ACTIVE) return {}
  if (directory) cwdForResolve = String(directory).replace(/\/$/, "")

  const instance = serverUrl?.toString().replace(/\/$/, "") ?? ""
  const nudgedSessions = new Set<string>()
  const reasoningTimers = new Map<string, ReturnType<typeof setTimeout>>()
  // Keyed by `${messageID}:${partID}`. Storing sessionID alongside the
  // buffered text (not just text -> string) lets flushReasoningForSession
  // below find and flush exactly the entries belonging to a session
  // that's about to go idle, without guessing.
  const reasoningEntries = new Map<string, { sessionID: string; text: string }>()

  /**
   * Immediately POST and remove one buffered reasoning entry, bypassing
   * its debounce timer. Used both for the session-idle flush below and
   * for cache-eviction, so neither path can silently discard content
   * that was never sent.
   */
  function flushReasoningEntry(key: string): void {
    const entry = reasoningEntries.get(key)
    clearTimeout(reasoningTimers.get(key))
    reasoningTimers.delete(key)
    reasoningEntries.delete(key)
    if (entry?.text) {
      void post(THOUGHTS_URL, {
        agent_name: AGENT,
        thought_type: "reasoning",
        content: truncate(entry.text, 2000),
      })
    }
  }

  /**
   * Flush every buffered-but-not-yet-sent reasoning entry for a session
   * that's about to go idle (Stop). Without this, a debounce timer up to
   * REASONING_DEBOUNCE_MS could still be pending when the process is put
   * to sleep or killed shortly after Stop — which happens routinely (the
   * whole point of "idle") — silently losing that last bit of reasoning.
   */
  function flushReasoningForSession(sessionID: string): void {
    for (const [key, entry] of reasoningEntries) {
      if (entry.sessionID === sessionID) flushReasoningEntry(key)
    }
  }

  const REASONING_DEBOUNCE_MS = 800
  const REASONING_MAX_ENTRIES = 300

  async function fetchMessages(sessionID: string, limit = 50): Promise<MessageEnvelope[]> {
    if (!instance) return []
    try {
      const res = await fetch(`${instance}/session/${sessionID}/message?limit=${limit}`, {
        signal: AbortSignal.timeout(4000),
      })
      if (!res.ok) return []
      return (await res.json()) as MessageEnvelope[]
    } catch {
      return []
    }
  }

  async function isRootSession(sessionID: string): Promise<boolean> {
    if (!instance) return true
    try {
      const res = await fetch(`${instance}/session/${sessionID}`, { signal: AbortSignal.timeout(3000) })
      if (!res.ok) return true
      const info = (await res.json()) as { parentID?: string }
      return !info.parentID
    } catch {
      return true
    }
  }

  return {
    // ── UserPromptSubmit ────────────────────────────────────────────────────
    "chat.message": async (input) => {
      await post(EVENTS_URL, {
        event_type: "UserPromptSubmit",
        session_id: input.sessionID,
        agent_id: AGENT,
      })
    },

    // ── PreToolUse: structural write guards ────────────────────────────────
    // Four layers, all bypassed by SOREN_PROTECTED_OVERRIDE=1 (manual ops):
    //   0. Lifecycle guard  — full-stack `soren.sh stop|restart` and killing
    //                         the main tmux session are human-only (sudo-
    //                         gated in the script; blocked outright here).
    //   1. Worktree jail    — a worker spawned with --worktree may not write
    //                         to the live checkout at all; its writes belong
    //                         in its worktree (merged via supervisor review).
    //   2. Protected paths  — recovery-critical code (orchestrator scripts,
    //                         this plugin, verification hooks, the shared
    //                         opencode lib, root soren.sh) must never be
    //                         edited in the LIVE checkout by any agent.
    //                         Worktree copies are editable; changes arrive
    //                         via reviewed git merges, which this gate does
    //                         not intercept.
    //   3. Supervisor block — the supervisor delegates code changes; it may
    //                         only edit its own memory files.
    "tool.execute.before": async (input, output) => {
      if (OVERRIDE) return

      if (["edit", "write", "patch"].includes(input.tool)) {
        const rawPath: string = output.args?.filePath ?? output.args?.file_path ?? ""
        const abs = resolvePath(rawPath)

        // Layer 1: worktree jail
        if (WORKTREE && abs && insideLiveCheckout(abs)) {
          throw new Error(
            `[SOREN] Worktree isolation: you were spawned into ${WORKTREE} — write there, not in the live checkout (${abs}). ` +
              `Your branch is merged by the supervisor after review.`,
          )
        }

        // Layer 2: protected recovery code in the live checkout
        if (abs && isProtectedLivePath(abs)) {
          throw new Error(
            `[SOREN] Protected path: ${relToHome(abs)} is recovery-critical and cannot be edited in the live checkout. ` +
              `Work in a worktree (workers spawn --worktree) and have the supervisor merge after review. ` +
              `Manual override: SOREN_PROTECTED_OVERRIDE=1.`,
          )
        }

        // Layer 2b: role-contract rule. Agents whose compiled contract
        // (.soren/run/contracts.json) declares protected_paths: "forbidden"
        // may not touch protected paths EVEN INSIDE their worktree. Agents
        // without a contract entry keep the uniform policy above.
        if (abs && isProtectedWorktreePath(abs) && contractForbidsProtected()) {
          throw new Error(
            `[SOREN] Contract rule violated (protected_paths: forbidden): the role contract for '${AGENT}' ` +
              `forbids editing recovery-critical path ${abs.slice(WORKTREE.length + 1)} even inside a worktree. ` +
              `Hand this change to an agent whose contract allows via-worktree edits. ` +
              `Manual override: SOREN_PROTECTED_OVERRIDE=1.`,
          )
        }

        // Layer 3: supervisor edits only its memory files
        if (AGENT === "supervisor") {
          const allowed =
            abs.includes("/.soren/") ||
            /(^|\/)MEMORY\.md$/.test(abs) ||
            abs.includes("/memory/") ||
            /reflection[^/]*\.md$/.test(abs)
          if (!allowed) {
            throw new Error(
              `[SOREN] Supervisor must not edit code files directly (${rawPath || "unknown path"}). ` +
                `Delegate the change to a worker via ./tools/workers spawn or ./tools/tasks add.`,
            )
          }
        }
        return
      }

      // Bash heuristic for layers 1+2: block write-shaped commands that
      // reference protected paths in the live checkout. Conservative by
      // design — git merge/log/diff and reads pass through untouched.
      if (input.tool === "bash") {
        const command: string = output.args?.command ?? input.args?.command ?? ""
        if (!command) return

        // Layer 0: full-stack lifecycle guard. `soren.sh stop|restart` (and
        // killing the main tmux session directly) destroys every agent —
        // including the one running the command, mid-execution. Both outages
        // on 2026-08-23 were exactly this: the supervisor self-decapitated
        // via `restart`, then the guard-implementing worker nuked the system
        // again by "testing" its own override against the live stack. The
        // script side is sudo-gated (human-only); this block makes agents
        // fail fast with guidance instead of hanging on a password prompt.
        // Applies in worktrees too: the session/port targets are global.
        const fullStackLifecycle = /soren\.sh['"]?\s+(stop|restart)\b/.test(command)
        const killsMainSession =
          /tmux\s+kill-session\s+-t\s+("?\$\{?SOREN_SESSION\}?"?|['"]?soren['"]?)($|[\s'";&|])/.test(command)
        if (fullStackLifecycle || killsMainSession) {
          throw new Error(
            `[SOREN] Human-only command blocked: full-stack stop/restart (or killing the main tmux session) ` +
              `takes down every agent including you, mid-command — this caused both 2026-08-23 outages. ` +
              `It is sudo-gated at the script level; there is no agent override and nothing to "test" against ` +
              `the live system. Server-only restart: ./soren.sh detached-restart --restart --detach`,
          )
        }

        const writey =
          /(^|[\s|;&])(>>?|sed\s+-i|tee\s|mv\s|cp\s|rm\s|chmod\s|truncate\s|git\s+(checkout|restore)\s)/.test(command)
        if (!writey) return
        const mentionsProtected =
          /(^|[\s\/'"=])(src\/orchestrator\/|\.opencode\/(plugins|hooks)\/|tools\/lib\/opencode\.sh|soren\.sh)/.test(command)
        if (!mentionsProtected) return
        // Worktree workers touch protected paths legitimately via relative
        // paths (their cwd is the worktree). Block only when the command
        // targets the live checkout explicitly, or the agent has no worktree.
        const targetsLive = command.includes(SOREN_HOME + "/")
        if (!WORKTREE || targetsLive) {
          throw new Error(
            `[SOREN] Protected path: this command appears to modify recovery-critical files in the live checkout. ` +
              `Work in a worktree (workers spawn --worktree); the supervisor merges after review. ` +
              `Manual override: SOREN_PROTECTED_OVERRIDE=1.`,
          )
        }
        // Contract rule: protected_paths "forbidden" agents lose the
        // worktree exemption for write-shaped commands on protected paths.
        if (contractForbidsProtected()) {
          throw new Error(
            `[SOREN] Contract rule violated (protected_paths: forbidden): the role contract for '${AGENT}' ` +
              `forbids modifying recovery-critical paths even inside a worktree — this command appears to do so. ` +
              `Hand this change to an agent whose contract allows via-worktree edits. ` +
              `Manual override: SOREN_PROTECTED_OVERRIDE=1.`,
          )
        }
      }
    },

    // ── PostToolUse: events, thoughts, audit, heartbeat, verify hooks ──────
    "tool.execute.after": async (input, output) => {
      const toolOutput = truncate(output.output, 10000)

      await Promise.all([
        post(EVENTS_URL, {
          event_type: "PostToolUse",
          session_id: input.sessionID,
          agent_id: AGENT,
          tool_name: input.tool,
          tool_input: truncate(input.args, 2000),
          tool_output: toolOutput,
        }),
        post(THOUGHTS_URL, {
          agent_name: AGENT,
          thought_type: "tool_result",
          tool_name: input.tool,
          tool_response: truncate(output.output, 500),
        }),
        auditLog(input.tool, input.args, input.sessionID),
        touchHeartbeat(),
      ])

      // Verification pipeline triggers on mailbox done reports via bash
      if (input.tool === "bash") {
        const command: string = input.args?.command ?? ""
        if (/(^|[\s;&|])(\.\/)?(tools\/)?mailbox +done\b/.test(command)) {
          const payload = {
            session_id: input.sessionID,
            tool_name: "Bash",
            tool_input: { command },
            tool_response: toolOutput,
          }
          spawnHook("verify-done.sh", payload)
          spawnHook("verify-ui-check.sh", payload)
        }
      }
    },

    // ── Bus events: reasoning stream + Stop (session.idle) ─────────────────
    event: async ({ event }) => {
      // stream-thought: forward completed reasoning parts (debounced 2s)
      if (event.type === "message.part.updated") {
        const part = (event as any).properties?.part
        if (
          part?.type === "reasoning" &&
          typeof part.text === "string" &&
          part.text.length > 0 &&
          typeof part.sessionID === "string"
        ) {
          const key = `${part.messageID}:${part.id}`
          reasoningEntries.set(key, { sessionID: part.sessionID, text: part.text })
          // Cap at REASONING_MAX_ENTRIES entries: previously the oldest
          // key was evicted by just deleting it — silently discarding
          // whatever content had buffered for it. Flush it instead, so
          // hitting the cap costs an early/out-of-order send, never a
          // lost one.
          if (reasoningEntries.size > REASONING_MAX_ENTRIES) {
            const oldest = reasoningEntries.keys().next().value
            if (oldest !== undefined && oldest !== key) flushReasoningEntry(oldest)
          }
          clearTimeout(reasoningTimers.get(key))
          reasoningTimers.set(
            key,
            setTimeout(() => flushReasoningEntry(key), REASONING_DEBOUNCE_MS),
          )
        }
        return
      }

      if (event.type !== "session.idle") return
      const sessionID: string = (event as any).properties?.sessionID ?? ""
      if (!sessionID) return

      // Flush any reasoning still sitting in its debounce window for
      // THIS session before anything else. Stop firing is exactly when
      // the process is likely to be put to sleep or killed shortly after
      // — if we left this to its own timer, that last bit of reasoning
      // could easily never get sent at all.
      flushReasoningForSession(sessionID)

      if (!(await isRootSession(sessionID))) return // subagent turns are not Stops

      const messages = await fetchMessages(sessionID)

      // Sort by message id ascending (ULIDs sort lexicographically) so that
      // responseContent / toolCallsSinceUser / last-assistant selection are
      // correct regardless of endpoint ordering. Fall back to the original
      // order if any message lacks an id.
      if (messages.length > 1 && messages.every((m) => typeof m.info?.id === "string" && m.info.id.length > 0)) {
        messages.sort((a, b) => {
          const ai = a.info!.id!
          const bi = b.info!.id!
          return ai < bi ? -1 : ai > bi ? 1 : 0
        })
      }

      // Report usage from the LAST assistant message only (Claude-hook usage
      // shape). Context size ≈ input + cache.read of the final message —
      // that's what the server's compaction-threshold math needs. Summing
      // across messages caused compaction storms.
      let lastAssistant: MessageEnvelope | undefined
      let responseContent = ""
      let toolCallsSinceUser = 0
      let hygieneSeen = false

      for (const msg of messages) {
        const role = msg.info?.role
        if (role === "assistant") lastAssistant = msg
        for (const part of msg.parts ?? []) {
          if (role === "assistant" && part.type === "text" && part.text) responseContent = part.text
          if (role === "user" && part.type === "text") {
            toolCallsSinceUser = 0
            hygieneSeen = false
          }
          if (part.type === "tool") {
            toolCallsSinceUser++
            const cmd: string = part.state?.input?.command ?? ""
            if (/git commit|tools\/journal|tools\/mailbox/.test(cmd)) hygieneSeen = true
          }
        }
      }

      const lastTokens = lastAssistant?.info?.tokens
      const usage = {
        input_tokens: lastTokens?.input ?? 0,
        output_tokens: lastTokens?.output ?? 0,
        cache_read_input_tokens: lastTokens?.cache?.read ?? 0,
        cache_creation_input_tokens: lastTokens?.cache?.write ?? 0,
      }

      // Race guard: session.idle can fire before the final text part is
      // visible via the API. Previously this only retried once, after a
      // fixed 800ms wait, and ONLY when usage.output_tokens > 0 — a gate
      // that itself isn't reliable evidence either way (usage reporting
      // can lag independently of message-text visibility). If the retry
      // still came up empty, `response_content` was sent as `undefined`,
      // and the backend (agent_events.py) then creates NO chat message
      // at all for that turn — the agent's actual response was fully and
      // silently lost from the dashboard, even though it was produced.
      // This was the single most direct match for "agent output doesn't
      // come back": a pure timing race, not a real absence of output.
      //
      // Fix: retry more persistently whenever there's any real evidence
      // this was an actual assistant turn (an assistant message exists,
      // tool calls happened, or usage was reported) — not gated on the
      // output_tokens heuristic alone — and if text is still genuinely
      // unrecoverable after retrying, send an explicit placeholder
      // instead of `undefined` so the turn is at least visible on the
      // dashboard with a pointer to where to find the real content,
      // rather than vanishing without a trace.
      const turnLikelyHadOutput = !!lastAssistant || usage.output_tokens > 0 || toolCallsSinceUser > 0
      if (!responseContent && turnLikelyHadOutput) {
        const backoffsMs = [500, 1000, 1500]
        for (const delay of backoffsMs) {
          await new Promise((r) => setTimeout(r, delay))
          const retry = await fetchMessages(sessionID)
          for (const msg of retry) {
            if (msg.info?.role !== "assistant") continue
            for (const part of msg.parts ?? []) {
              if (part.type === "text" && part.text) responseContent = part.text
            }
          }
          if (responseContent) break
        }
        if (!responseContent) {
          console.error(
            `[soren-bridge] Stop event for session ${sessionID}: no response text found after ${backoffsMs.length} retries ` +
              `despite evidence of a real turn (assistant=${!!lastAssistant}, output_tokens=${usage.output_tokens}, tools=${toolCallsSinceUser}) — sending placeholder instead of silently dropping the turn`,
          )
          responseContent =
            "[SYS] (response text unavailable — the agent completed a turn but its text wasn't retrievable via the API in time; check the terminal pane for the actual output)"
        }
      }

      // Stop is the single event that turns into the dashboard chat
      // message for this turn — worth a couple of retries on top of
      // post()'s own logging if the server is transiently unreachable,
      // since losing this one silently drops the whole visible response
      // (unlike e.g. a single missed PostToolUse, which is one of many).
      await post(
        EVENTS_URL,
        {
          event_type: "Stop",
          session_id: sessionID,
          agent_id: AGENT,
          response_content: responseContent || undefined,
          usage,
        },
        { retries: 2 },
      )

      // stop-gate: one nudge per session when substantial work ended without
      // a commit, journal entry, or mailbox report. Supervisor and permanent
      // workers are exempt (matches stop-gate.sh).
      if (!isSupervisor && !isPermanent && toolCallsSinceUser >= 5 && !hygieneSeen && !nudgedSessions.has(sessionID)) {
        nudgedSessions.add(sessionID)
        // Cap at 200 entries — evict the oldest (first) value when exceeded.
        if (nudgedSessions.size > 200) {
          const oldest = nudgedSessions.values().next().value
          if (oldest !== undefined) nudgedSessions.delete(oldest)
        }
        if (instance) {
          void fetch(`${instance}/session/${sessionID}/prompt_async`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              parts: [
                {
                  type: "text",
                  text:
                    "[SYS] Stop-gate: you finished a work burst without committing, journaling, or reporting. " +
                    "If your task produced changes: commit them, journal with ./tools/journal log, and report via " +
                    "./tools/mailbox done or ./tools/mailbox blocked. If there is truly nothing to record, reply [SYS] and stop.",
                },
              ],
            }),
            signal: AbortSignal.timeout(4000),
          }).catch(() => {})
        }
      }
    },
  }
}
