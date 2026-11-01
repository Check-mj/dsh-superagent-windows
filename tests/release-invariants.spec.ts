// Release invariants: the promises a published build makes, checked mechanically.
//
// Attribution is a hard requirement of this adaptation, and the repository is public: upstream and its licence must stay
// visible, and no credential may ever land in a tracked file. These checks run with the normal test suite so a release
// cannot quietly lose either.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8')
const UPSTREAM = 'deepseek-ai/dsh-superagent-prototype'
const BUILD = 'Check-mj/dsh-superagent-windows'

it('keeps the upstream attribution visible in every place a reader looks', () => {
  const license = read('LICENSE')
  expect(license).toContain('MIT License')
  expect(license).toContain('DeepSeek Harness Team')

  const notice = read('NOTICE')
  expect(notice).toContain(UPSTREAM)
  expect(notice).toContain('DeepSeek Harness Team')

  const readme = read('README.md')
  expect(readme).toContain(UPSTREAM)
  expect(readme).toContain(BUILD)
  expect(readme).toContain('DeepSeek Harness Team')
  // The upstream disclaimer itself must survive: this is not an official DeepSeek product.
  expect(readme).toMatch(/非官方产品|not an official DeepSeek product/i)

  for (const locale of ['locale/zh.json', 'locale/en.json']) {
    const text = read(locale)
    expect(text, locale).toContain(UPSTREAM)
    expect(text, locale).toContain(BUILD)
    expect(text, locale).toContain('DeepSeek Harness Team')
  }
})

it('keeps the package metadata pointing at upstream while claiming the build', () => {
  const pkg = JSON.parse(read('package.json')) as Record<string, unknown>
  expect(pkg.license).toBe('MIT')
  expect(JSON.stringify(pkg.repository)).toContain(UPSTREAM)
  expect(String(pkg.homepage)).toContain(BUILD)
  expect(String(pkg.description)).toMatch(/适配版|adaptation/i)
  // The install contract is the package id; renaming it would break installed instances.
  expect(pkg.name).toBe('dsh-superagent')
})

it('has a changelog with the published version', () => {
  const changelog = read('CHANGELOG.md')
  expect(changelog).toMatch(/^## \[0\.\d+\.\d+\]/m)
  expect(changelog).toContain('DSH-Superagent')
})

it('never trades in a credential', () => {
  const suspicious = [
    /ghp_[A-Za-z0-9]{20,}/, // GitHub personal access token
    /github_pat_[A-Za-z0-9_]{20,}/, // fine-grained token
    /sk-[A-Za-z0-9]{20,}/, // provider API key shape
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  ]
  const offenders: string[] = []
  for (const relative of ['package.json', 'README.md', 'NOTICE', 'CHANGELOG.md', 'install.ps1', 'cordis.patch.yml']) {
    if (!existsSync(join(ROOT, relative))) continue
    const text = read(relative)
    for (const pattern of suspicious) if (pattern.test(text)) offenders.push(relative)
  }
  expect(offenders).toEqual([])
})
