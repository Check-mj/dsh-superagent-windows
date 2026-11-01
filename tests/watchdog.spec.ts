// The Watchdog digest: what the external control loop is told, and what it is asked to judge (article §6).
import { expect, it } from 'vitest'
import { assignmentStates, quietMinutes, watchdogDigest, watchdogProblems } from '../src/app/watchdog.ts'

const snapshot = {
  tickets: [{ id: 't1', title: 'Add a Getting started section', states: ['running'], quietMinutes: 42 }],
  running: 1,
  queued: 1,
  maxWorkers: 3,
  problems: [{ part: 'github:b', state: 'error', detail: '1 consecutive failed polls' }],
  apiBase: 'http://127.0.0.1:3082/orchestrator/api',
  paused: false,
}

it('states what the system believes, with the quiet time it needs to judge progress', () => {
  const text = watchdogDigest(snapshot, 30)
  expect(text).toContain('every 30 min')
  expect(text).toContain('1/3 running, 1 queued')
  expect(text).toContain('t1 "Add a Getting started section" — running, quiet for 42 min')
  expect(text).toContain('github:b: error — 1 consecutive failed polls')
  // The Watchdog is outside the Router: it must not take work or answer people.
  expect(text).toContain('You are not the Router')
  // It acts through the local management API, whose header the digest restates.
  expect(text).toContain('x-orchestrator-request: 1')
  expect(text).toContain('http://127.0.0.1:3082/orchestrator/api')
})

it('asks for silence when everything is healthy, so the loop costs no attention by default', () => {
  const text = watchdogDigest({ ...snapshot, tickets: [], queued: 0, running: 0, problems: [], paused: true }, 30)
  expect(text).toContain('No open Tickets')
  expect(text).toContain('Every health part is ready')
  expect(text).toContain('processing paused')
  expect(text).toContain('Stay quiet when everything is healthy')
})

it('reports the runtime first and derives the pieces the digest reads from a Ticket', () => {
  expect(watchdogProblems({
    launch: { state: 'ready', detail: '' },
    runtime: { state: 'paused', detail: 'Waiting for the deployment check' },
    github: { state: 'error', detail: 'boom' },
  }).map(problem => problem.part)).toEqual(['runtime', 'github'])

  const ticket = { assignments: [{ state: 'running' }, { state: 'ended' }] } as Parameters<typeof assignmentStates>[0]
  expect(assignmentStates(ticket)).toEqual(['running', 'ended'])
  // A missing or future timestamp never counts as quiet.
  expect(quietMinutes(undefined, Date.now())).toBe(0)
  expect(quietMinutes(new Date(Date.now() - 90 * 60_000).toISOString(), Date.now())).toBeCloseTo(90, 0)
})
