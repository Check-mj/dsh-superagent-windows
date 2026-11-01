// The declarative settings file: a partial, reviewable overlay a team keeps in version control.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { loadDeclarative, mergeDeclarative } from '../src/app/config-file.ts'
import { SettingsSchema } from '../src/policy.ts'

const base = SettingsSchema.parse({})
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

it('overlays only the blocks the file declares, and leaves the stored ones alone', () => {
  const declared = clone({ ...base, executor: { ...base.executor, prepare: 'make worktree' } })
  const merged = mergeDeclarative(base, declared)
  expect(merged.executor.prepare).toBe('make worktree')
  // A block the file does not mention keeps its stored value byte for byte.
  expect(merged.policy).toEqual(base.policy)
  expect(merged.eval).toEqual(base.eval)
})

it('merges the Source and Policy records key by key instead of replacing them', () => {
  const stored = clone(base)
  stored.sources = { feishu: { enabled: false, config: {} } } as typeof stored.sources
  const declared = {
    sources: { github: { enabled: true, config: { repository: 'acme/widgets', cli: 'gh' } } },
  }
  const merged = mergeDeclarative(SettingsSchema.parse(stored), declared)
  expect(Object.keys(merged.sources).sort()).toEqual(['feishu', 'github'])
  expect(merged.sources.github).toEqual({ enabled: true, config: { repository: 'acme/widgets', cli: 'gh' } })
})

it('reports a missing file, bad JSON and schema failures as text instead of throwing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-config-'))
  try {
    const missing = loadDeclarative(join(dir, 'absent.json'), base)
    expect('error' in missing && missing.error).toContain('could not be read')

    const broken = join(dir, 'broken.json')
    await writeFile(broken, '{ nope', 'utf8')
    const invalid = loadDeclarative(broken, base)
    expect('error' in invalid && invalid.error).toContain('not valid JSON')

    const wrong = join(dir, 'wrong.json')
    await writeFile(wrong, JSON.stringify({ eval: { mode: 'nonsense' } }), 'utf8')
    const refused = loadDeclarative(wrong, base)
    expect('error' in refused && refused.error).toContain('invalid')

    const good = join(dir, 'good.json')
    await writeFile(good, JSON.stringify({ executor: { ...base.executor, prepare: 'make x' } }), 'utf8')
    const applied = loadDeclarative(good, base)
    expect('settings' in applied && applied.settings.executor.prepare).toBe('make x')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

it('removes what $prune names, so a Source dropped from the file does not linger in the stored settings', () => {
  const stored = clone(base)
  stored.sources = {
    github: { enabled: true, config: {} },
    stale: { kind: 'github', enabled: true, config: {} },
  } as typeof stored.sources
  const declared = { $prune: { sources: ['stale'] }, executor: { ...base.executor, maxWorkers: 2 } }
  const merged = mergeDeclarative(SettingsSchema.parse(stored), declared)
  expect(Object.keys(merged.sources)).toEqual(['github'])
  expect(merged.executor.maxWorkers).toBe(2)
})
