/**
 * Background subagents: the half of article §4.1 that DSH does not expose (async subagent tool calls).
 *
 * A call must return immediately with a Started acknowledgement, the work runs in its own Session, and the result
 * arrives later as an event message addressed to the parent Session — never as a blocking tool result. The task can be
 * cancelled, and a result too large for the window is spilled with a continuation hint, exactly as §3.3 asks.
 *
 * This module is the lifecycle only: no DSH or plugin types, everything injected, so the behaviour is testable without
 * a live model. Exposing it as a tool is a separate, opt-in wiring step (docs/017 P1).
 */

export type SubagentStatus = 'running' | 'done' | 'cancelled'

export interface SubagentRecord {
  /** Stable id handed to the model in the Started acknowledgement. */
  id: string
  /** Session that asked for the work; the result is delivered to it. */
  parent: string
  /** Session the work runs in. */
  session: string
  prompt: string
  status: SubagentStatus
  startedAt: number
  /** Set once the result has been delivered, so a second completion cannot deliver twice. */
  deliveredAt?: number
}

export interface SubagentHost {
  /** Creates the child Session in `cwd` (idempotent: an existing Session is reused). */
  ensure(session: string, title: string, prompt: string, cwd?: string): Promise<void>
  /** Delivers a message: the task to the child, the result to the parent. */
  deliver(session: string, text: string): Promise<void>
  now(): number
  log(message: string): void
}

export interface SubagentOptions {
  /** Delivers ids, so a caller can keep them readable in logs and tests. */
  nextId: (parent: string, startedAt: number) => string
  /** Characters of a result kept inline before the rest is spilled behind a continuation hint (§3.3). */
  inlineChars?: number
  /** Finished records older than this are dropped, so a long-running process does not accumulate them. */
  keepFinishedMs?: number
}

export const DEFAULT_INLINE_CHARS = 1200
const DEFAULT_KEEP_FINISHED_MS = 60 * 60 * 1000

/** The message a parent Session receives when its background subagent ends. */
export function subagentFinishedMessage(record: SubagentRecord, result: string, inlineChars: number): string {
  const head = `[background subagent ${record.id} finished]`
  const body = result.trim() || '(the subagent returned nothing)'
  if (body.length <= inlineChars) return `${head}\n${body}`
  const spilled = body.length - inlineChars
  return `${head}\n${body.slice(0, inlineChars)}\n… ${spilled} characters spilled; ask for subagent ${record.id}'s output if you need the rest.`
}

/** The lifecycle of one process's background subagents: start returns at once, finish reports back once, cancel stays silent. */
export class BackgroundSubagents {
  private readonly records = new Map<string, SubagentRecord>()
  private readonly inlineChars: number
  private readonly keepFinishedMs: number

  constructor(private readonly host: SubagentHost, private readonly options: SubagentOptions) {
    this.inlineChars = options.inlineChars ?? DEFAULT_INLINE_CHARS
    this.keepFinishedMs = options.keepFinishedMs ?? DEFAULT_KEEP_FINISHED_MS
  }

  /**
   * Starts one background subagent and returns at once. The acknowledgement is the whole tool result: the parent keeps
   * working while the child runs.
   */
  async start(input: { parent: string; session: string; prompt: string; title?: string; cwd?: string }): Promise<SubagentRecord> {
    const startedAt = this.host.now()
    const id = this.options.nextId(input.parent, startedAt)
    const record: SubagentRecord = { id, parent: input.parent, session: input.session, prompt: input.prompt, status: 'running', startedAt }
    this.records.set(id, record)
    this.host.log(`background subagent ${id} started by ${input.parent} in ${input.session}`)
    try {
      await this.host.ensure(input.session, input.title ?? `subagent ${id}`, input.prompt, input.cwd)
      await this.host.deliver(input.session, input.prompt)
    } catch (error) {
      record.status = 'cancelled'
      this.host.log(`background subagent ${id} could not start: ${error instanceof Error ? error.message : String(error)}`)
      throw error
    }
    this.prune(startedAt)
    return record
  }

  /** Delivers a child's final answer to the parent, once. A cancelled or already delivered subagent is ignored. */
  async finish(session: string, result: string): Promise<boolean> {
    const record = [...this.records.values()].find(candidate => candidate.session === session)
    if (!record || record.status !== 'running' || record.deliveredAt !== undefined) return false
    record.status = 'done'
    record.deliveredAt = this.host.now()
    await this.host.deliver(record.parent, subagentFinishedMessage(record, result, this.inlineChars))
    this.host.log(`background subagent ${record.id} finished and reported to ${record.parent}`)
    return true
  }

  /** Stops a subagent: its result is not delivered, and a later completion is ignored. */
  cancel(id: string): boolean {
    const record = this.records.get(id)
    if (!record || record.status !== 'running') return false
    record.status = 'cancelled'
    this.host.log(`background subagent ${id} cancelled by its parent; its result will not be delivered`)
    return true
  }

  /** The record for an id, for status questions and cancellation. */
  get(id: string): SubagentRecord | undefined { return this.records.get(id) }

  /** Running subagents of one parent, so a Session can see what it still owes attention to. */
  running(parent?: string): SubagentRecord[] {
    return [...this.records.values()].filter(record => record.status === 'running' && (parent === undefined || record.parent === parent))
  }

  /** Drops finished or cancelled records past their retention, keeping the map bounded. */
  private prune(now: number): void {
    for (const [id, record] of this.records) {
      if (record.status === 'running') continue
      const endedAt = record.deliveredAt ?? record.startedAt
      if (now - endedAt >= this.keepFinishedMs) this.records.delete(id)
    }
  }
}

/**
 * The text a background subagent reports back: the last assistant message of its Session, without reasoning blocks.
 * Reading the final message rather than a report keeps the mechanism independent of Ticket reports (a subagent may have
 * no Ticket at all).
 */
export function assistantResult(events: readonly { type: string; data?: unknown }[]): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (!event || event.type !== 'assistant/message') continue
    const data = event.data as { message?: { content?: { type?: string; text?: string }[] } } | undefined
    const text = (data?.message?.content ?? []).filter(block => block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text).join('\n').trim()
    if (text) return text
  }
  return ''
}
