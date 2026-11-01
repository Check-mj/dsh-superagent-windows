// Portability guard: nothing in this repository may name one developer's machine.
//
// The product is published for other people's computers, so tracked text files must not contain absolute paths or user
// names from the machine it was developed on. The patterns are assembled from fragments so this file does not match
// itself.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')
const SKIP = new Set(['node_modules', '.git', '.artifacts', 'lib', 'Superagent', 'coverage', 'dist'])
const TEXT = /\.(md|ts|tsx|js|mjs|cjs|json|ya?ml|ps1|cmd|sh|txt)$/
const BINARY = /\.(png|ico|jpg|jpeg|webp|zip|zst|zstd|exe|dll|pak|dat|bin|pdf)$/

/** Absolute paths that only exist on the development machine, or that machine's user name. */
const FORBIDDEN: { name: string; pattern: RegExp }[] = [
  { name: 'developer drive path', pattern: new RegExp('D:' + '[\\\\/]{1,2}' + '1111') },
  { name: 'developer user name', pattern: new RegExp('Users' + '[\\\\/]{1,2}' + 'Chen' + '\\b') },
  { name: 'developer home path', pattern: new RegExp('[\\\\/]' + 'home' + '[\\\\/]' + 'chen' + '[\\\\/]') },
  { name: 'development checkout name', pattern: new RegExp('superagent' + '-app') },
]

/** Every tracked-looking text file below the repository root. */
function textFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    if (SKIP.has(entry)) continue
    const full = join(directory, entry)
    const info = statSync(full)
    if (info.isDirectory()) { textFiles(full, found); continue }
    if (BINARY.test(entry) || !TEXT.test(entry)) continue
    found.push(full)
  }
  return found
}

it('never names the development machine, so another computer can use the repository as is', () => {
  const offenders: string[] = []
  for (const file of textFiles(ROOT)) {
    const text = readFileSync(file, 'utf8')
    for (const { name, pattern } of FORBIDDEN) {
      const match = pattern.exec(text)
      if (!match) continue
      const line = text.slice(0, match.index).split('\n').length
      offenders.push(`${relative(ROOT, file).replace(/\\/g, '/')}:${line} — ${name}`)
    }
  }
  expect(offenders).toEqual([])
})
