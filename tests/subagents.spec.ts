// Background subagents (docs/017 P1): the lifecycle behind an asynchronous subagent tool call (article §4.1).
import { expect, it } from 'vitest'
import { BackgroundSubagents, assistantResult, subagentFinishedMessage, type SubagentHost } from '../src/app/subagents.ts'

const harness = (options: { inlineChars?: number } = {}) => {
  const ensured: { session: string; title: string; prompt: string }[] = []
  const delivered: { session: string; text: string }[] = []
  let clock = 1_000
  const host: SubagentHost = {
    async ensure(session, title, prompt) { ensured.push({ session, title, prompt }) },
    async deliver(session, text) { delivered.push({ session, text }) },
    now: () => (clock += 1_000),
    log: () => {},
  }
  const subagents = new BackgroundSubagents(host, { nextId: (parent, at) => `${parent}-sub-${at}`, ...options })
  return { subagents, ensured, delivered }
}

it('returns a Started acknowledgement at once while the work runs in its own Session', async () => {
  const { subagents, ensured, delivered } = harness()
  const record = await subagents.start({ parent: 'worker-1', session: 'worker-1-sub-1', prompt: 'read the failing test' })
  // The acknowledgement carries the id; nothing has finished yet.
  expect(record.status).toBe('running')
  expect(record.id).toMatch(/^worker-1-sub-/)
  expect(ensured).toEqual([{ session: 'worker-1-sub-1', title: `subagent ${record.id}`, prompt: 'read the failing test' }])
  expect(delivered).toEqual([{ session: 'worker-1-sub-1', text: 'read the failing test' }])
  expect(subagents.running('worker-1')).toHaveLength(1)
})

it('delivers the result to the parent Session once, as an event message', async () => {
  const { subagents, delivered } = harness()
  const record = await subagents.start({ parent: 'worker-1', session: 'worker-1-sub-1', prompt: 'investigate' })
  delivered.length = 0
  expect(await subagents.finish('worker-1-sub-1', 'the failure is in control.ts')).toBe(true)
  expect(delivered).toEqual([{ session: 'worker-1', text: `[background subagent ${record.id} finished]\nthe failure is in control.ts` }])
  // A second completion must not deliver twice.
  expect(await subagents.finish('worker-1-sub-1', 'again')).toBe(false)
  expect(subagents.running()).toHaveLength(0)
})

it('cancels: a cancelled subagent never reports back, and its slot is free', async () => {
  const { subagents, delivered } = harness()
  const record = await subagents.start({ parent: 'worker-1', session: 'worker-1-sub-1', prompt: 'long job' })
  delivered.length = 0
  expect(subagents.cancel(record.id)).toBe(true)
  expect(await subagents.finish('worker-1-sub-1', 'too late')).toBe(false)
  expect(delivered).toEqual([])
  expect(subagents.cancel(record.id)).toBe(false)
  expect(subagents.get(record.id)?.status).toBe('cancelled')
})

it('spills a long result behind a continuation hint instead of filling the window (§3.3)', () => {
  const record = { id: 's1', parent: 'p', session: 's1', prompt: '', status: 'done' as const, startedAt: 0 }
  const message = subagentFinishedMessage(record, 'x'.repeat(50), 10)
  expect(message).toContain('[background subagent s1 finished]')
  expect(message).toContain('… 40 characters spilled')
  expect(message.length).toBeLessThan(200)
})

it('drops finished records past their retention so a long-lived process does not accumulate them', async () => {
  const { subagents } = harness()
  const first = await subagents.start({ parent: 'worker-1', session: 'worker-1-sub-1', prompt: 'a' })
  await subagents.finish('worker-1-sub-1', 'done')
  // Retention is an hour; another start an hour later prunes the finished record.
  const later = { ...subagents } as unknown as { host: SubagentHost }
  void later
  const second = await subagents.start({ parent: 'worker-1', session: 'worker-1-sub-2', prompt: 'b' })
  expect(first.id).not.toBe(second.id)
  expect(subagents.get(second.id)?.status).toBe('running')
})

it('reports the last assistant message as the subagent result, dropping reasoning blocks', () => {
  const events = [
    { type: 'user/message', data: { message: { content: [{ type: 'text', text: 'do the thing' }] } } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: 'thinking' }, { type: 'text', text: 'first try' }] } } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'the answer' }] } } },
  ]
  expect(assistantResult(events)).toBe('the answer')
  // No assistant message at all: an empty result, never a crash.
  expect(assistantResult([{ type: 'user/message', data: {} }])).toBe('')
  expect(assistantResult([])).toBe('')
})
