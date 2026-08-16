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

const env = process.env
const ACTIVE = env.SOREN_AGENT === "true" && !!env.SOREN_AGENT_NAME
const AGENT = env.SOREN_AGENT_NAME ?? "unknown"
const SOREN_HOME = env.SOREN_HOME ?? process.cwd()
const API = `http://localhost:${env.SOREN_PORT ?? "8000"}`
const EVENTS_URL = env.SOREN_WEBHOOK_URL ?? `${API}/api/agent-events`
const THOUGHTS_URL = env.SOREN_THOUGHTS_URL ?? `${API}/api/thoughts`

const isSupervisor = AGENT === "supervisor" || AGENT.startsWith("sup-") || AGENT.startsWith("supervisor-")
const isPermanent = AGENT.startsWith("perm-")

function truncate(s: unknown, n: number): string {
  const str = typeof s === "string" ? s : JSON.stringify(s ?? "")
  return str.length > n ? str.slice(0, n) + "…" : str
}

async function post(url: string, body: unknown): Promise<void> {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4000),
    })
  } catch {
    // SOREN server may be down; never break the agent over telemetry.
  }
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

  const instance = serverUrl?.toString().replace(/\/$/, "") ?? ""
  const nudgedSessions = new Set<string>()
  const reasoningTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const reasoningText = new Map<string, string>()

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

    // ── PreToolUse: supervisor edit blocking ───────────────────────────────
    "tool.execute.before": async (input, output) => {
      if (AGENT !== "supervisor") return
      if (!["edit", "write", "patch"].includes(input.tool)) return
      const filePath: string = output.args?.filePath ?? output.args?.file_path ?? ""
      const allowed =
        filePath.includes("/.soren/") ||
        /(^|\/)MEMORY\.md$/.test(filePath) ||
        filePath.includes("/memory/") ||
        /reflection[^/]*\.md$/.test(filePath)
      if (!allowed) {
        throw new Error(
          `[SOREN] Supervisor must not edit code files directly (${filePath || "unknown path"}). ` +
            `Delegate the change to a worker via ./tools/workers spawn or ./tools/tasks add.`,
        )
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
        if (part?.type === "reasoning" && typeof part.text === "string" && part.text.length > 0) {
          const key = `${part.messageID}:${part.id}`
          reasoningText.set(key, part.text)
          // Cap maps at 100 entries: evict the oldest key if a part never completes.
          if (reasoningText.size > 100) {
            const oldest = reasoningText.keys().next().value
            if (oldest !== undefined && oldest !== key) {
              clearTimeout(reasoningTimers.get(oldest))
              reasoningTimers.delete(oldest)
              reasoningText.delete(oldest)
            }
          }
          clearTimeout(reasoningTimers.get(key))
          reasoningTimers.set(
            key,
            setTimeout(() => {
              const content = reasoningText.get(key)
              reasoningTimers.delete(key)
              reasoningText.delete(key)
              if (content) {
                void post(THOUGHTS_URL, {
                  agent_name: AGENT,
                  thought_type: "reasoning",
                  content: truncate(content, 2000),
                })
              }
            }, 2000),
          )
        }
        return
      }

      if (event.type !== "session.idle") return
      const sessionID: string = (event as any).properties?.sessionID ?? ""
      if (!sessionID) return
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
      // visible via the API. If the assistant produced output but we found
      // no text, wait briefly and refetch once.
      if (!responseContent && usage.output_tokens > 0) {
        await new Promise((r) => setTimeout(r, 800))
        const retry = await fetchMessages(sessionID)
        for (const msg of retry) {
          if (msg.info?.role !== "assistant") continue
          for (const part of msg.parts ?? []) {
            if (part.type === "text" && part.text) responseContent = part.text
          }
        }
      }

      await post(EVENTS_URL, {
        event_type: "Stop",
        session_id: sessionID,
        agent_id: AGENT,
        response_content: responseContent || undefined,
        usage,
      })

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
