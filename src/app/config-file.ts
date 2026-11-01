/**
 * Declarative settings: a reviewable JSON document that a team keeps under version control and that the runtime
 * applies at startup, so Sources, Policy, Execution and Prompts are diffable instead of living only in a panel.
 * Omitted blocks keep whatever the panel already stored, which makes a partial file a safe overlay.
 */
import { readFileSync } from 'node:fs'
import { SettingsSchema } from '../policy.ts'

type Settings = ReturnType<typeof SettingsSchema.parse>
export type DeclarativeLoad = { settings: Settings } | { error: string }

const describe = (error: unknown): string => error instanceof Error ? error.message : String(error)
const issues = (error: { issues: readonly { path: PropertyKey[]; message: string }[] }): string =>
  error.issues.map(issue => (issue.path.map(String).join('.') || '(root)') + ': ' + issue.message).join('; ')

/**
 * Merge the declared blocks over the current settings. `sources` and `policy` merge key by key, so a file that
 * only declares the GitHub Source leaves an installed Feishu Source alone, and a Policy file that only names the
 * GitHub allow list keeps the Feishu part.
 */
export function mergeDeclarative(current: Settings, declared: unknown): Settings {
  // Directives start with `$` and are read before validation, because the settings schema is strict and knows
  // nothing about them. `$prune` names what must disappear: a file that only adds and overrides cannot undo a
  // Source an earlier file declared, which would leave a stale instance in the stored settings forever.
  const raw = (declared ?? {}) as Record<string, unknown>
  const prune = (raw.$prune ?? {}) as { sources?: string[] }
  const declaredBlocks = Object.fromEntries(Object.entries(raw).filter(([name]) => !name.startsWith('$')))
  const parsed = SettingsSchema.partial().safeParse(declaredBlocks)
  if (!parsed.success) throw new Error(issues(parsed.error))
  const data = parsed.data as Record<string, unknown>
  const merged = { ...current, ...data } as Settings
  const sources = { ...current.sources } as Record<string, unknown>
  for (const id of prune.sources ?? []) delete sources[id]
  merged.sources = { ...sources, ...(data.sources as object ?? {}) } as Settings['sources']
  if (data.policy) merged.policy = { ...current.policy, ...(data.policy as object) } as Settings['policy']
  // Parse again so cross-block invariants (a Source kind whose config a Policy part names) are checked once merged.
  return SettingsSchema.parse(merged)
}

/** Read and merge one declarative settings file; every failure is reported as text for the operator, never thrown. */
export function loadDeclarative(path: string, current: Settings): DeclarativeLoad {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    return { error: 'The declarative settings file could not be read (' + path + '): ' + describe(error) }
  }
  let declared: unknown
  try {
    declared = JSON.parse(text)
  } catch (error) {
    return { error: 'The declarative settings file is not valid JSON (' + path + '): ' + describe(error) }
  }
  try {
    return { settings: mergeDeclarative(current, declared) }
  } catch (error) {
    return { error: 'The declarative settings file is invalid (' + path + '): ' + describe(error) }
  }
}
