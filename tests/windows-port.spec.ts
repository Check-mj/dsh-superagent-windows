// Temporary verification of the Windows port of src/infra/environment.ts.
// Run with: `pnpm vitest run verify-shim.test.ts`
import { readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { agentGhConfig, agentVariables, workerBin, workerGitConfig, writeEnvironment } from '../src/infra/environment.ts'

// Every path is derived, so this contract test runs on any machine.
const stateDir = join(tmpdir(), 'dsh-superagent-windows-port')
const cli = join(tmpdir(), 'dsh-superagent-fake-tools', 'gh.exe')
const deployment = {
  stateDir,
  repository: 'acme/widgets',
  github: { cli, login: 'agent-bot', noreply: '1+agent-bot@users.noreply.github.com' },
}

it('writes batch shims, recognises its own marker, and isolates the agent account', async () => {
  await rm(stateDir, { recursive: true, force: true })
  await writeEnvironment(deployment, ['python', 'gh', 'git', 'myblocked'])

  const entries = await readdir(workerBin(stateDir))
  console.log('worker-bin entries:', entries)
  // `gh` and `git` are worker commands and never blocked; python and myblocked become failing shims.
  // `lark-cli` is always written: without a Feishu bot it is a shim that explains why it is unavailable.
  expect(entries.sort()).toEqual(['gh.cmd', 'lark-cli.cmd', 'myblocked.cmd', 'python.cmd'])

  const gh = await readFile(`${workerBin(stateDir)}/gh.cmd`, 'utf8')
  console.log('--- gh.cmd ---\n' + gh)
  expect(gh.startsWith('@echo off\r\n')).toBe(true)
  expect(gh).toContain('"' + cli + '" %*')
  expect(gh).toContain('Written by dsh-superagent')

  const blocked = await readFile(`${workerBin(stateDir)}/python.cmd`, 'utf8')
  console.log('--- python.cmd ---\n' + blocked)
  expect(blocked).toContain('is blocked in this installation')
  expect(blocked.trimEnd().endsWith('exit /b 1')).toBe(true)

  console.log('--- worker-gitconfig ---\n' + await readFile(workerGitConfig(stateDir), 'utf8'))
  console.log('GH_CONFIG_DIR override:', agentVariables(stateDir).GH_CONFIG_DIR)
  expect(agentVariables(stateDir).GH_CONFIG_DIR).toBe(agentGhConfig(stateDir))
  await expect(readdir(agentGhConfig(stateDir))).resolves.toBeDefined()

  // Idempotency: setup re-runs this on every start, so an unrecognised marker would raise `foreignFile`.
  await writeEnvironment(deployment, ['python', 'gh', 'git', 'myblocked'])
  expect((await readdir(workerBin(stateDir))).sort()).toEqual(['gh.cmd', 'lark-cli.cmd', 'myblocked.cmd', 'python.cmd'])
})
