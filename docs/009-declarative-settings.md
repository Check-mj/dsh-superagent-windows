# 009 声明式配置（我们相对上游的增量）

上游把 Sources、Policy、Execution 和 Prompts 都交给面板管理，配置存在 DSH 的 settings 存储里（`orchestrator.sqlite`）。这对一个人试用够用，对**团队**不够：改配置没法 review、没法 diff、换机器要手点一遍、也说不清"上周为什么它不接单"。

这一章描述我们的增量：**把配置变成一个可以进版本库的 JSON 文件**，启动时应用。

> 这是本 fork 的扩展，不在官方原型里。实现只有约 60 行，坐标 `src/app/config-file.ts`，并在 `WINDOWS-DELTA.md` 里记为增量项。

## 1. 怎么启用

1. 写一个 JSON 文件，放在你愿意的地方（推荐随仓库：`<checkout>/superagent.settings.json`）。
2. 在 profile 的机器配置里指出它的绝对路径：

```yaml
# ~/.dsh/profiles/superagent/cordis.patch.yml
- id: dsh-superagent
  config:
    stateDir: C:/Users/<you>/.dsh/state/superagent
    configPath: C:/path/to/superagent.settings.json
```

3. 重启服务（`install.cmd -Force` 不会覆盖 `configPath`，它写在 profile 里）。

## 2. 文件格式

**是 JSON，不是 YAML**，原因很实际：项目已有依赖里没有 YAML 解析器，为一个配置文件引入新依赖不值得；JSON 同样可 diff、可 review、可被 CI 校验。任何键都是可选的——**没写的块保持面板里已存的值**。

```json
{
  "sources": {
    "github": {
      "enabled": true,
      "config": { "repository": "acme/widgets", "cli": "C:/tools/gh/bin/gh.exe" }
    }
  },
  "policy": {
    "sources": { "github": { "allowed": [{ "id": "alice" }, { "id": "bob" }] } }
  },
  "executor": {
    "prepare": "C:/path/to/prepare-ticket.cmd",
    "maxWorkers": 3
  }
}
```

字段名与面板/管理 API 完全一致（见 `docs/006-deployment.md` 的 blocks 一节），因为校验复用的是同一份 `SettingsSchema`。

## 3. 合并规则

| 块 | 规则 |
|---|---|
| `sources` | **逐键合并**：只声明 `github` 时，已安装的 `feishu` 保持原样 |
| `policy` | 顶层字段逐字段覆盖；`policy.sources` 逐键合并 |
| `eval` / `executor` | 整块覆盖（该块声明的字段生效，未声明的取 schema 默认值） |

合并结果会再走一次 `SettingsSchema.parse()`，因此跨块约束（例如 Policy 里点名了一个未安装的 Source）仍然会被拦下。

## 4. 时机与优先级（重要取舍）

- 应用时机：`Runtime.initialize()` 里、**setup 之前**。所以文件里的仓库与 CLI 会先于账号检查生效。
- 优先级：**文件 > 面板**。面板之后改的值会被下一次启动覆盖。这是 config-as-code 的必然取舍：想长期生效就改文件，临时验证用面板。

## 5. 失败行为

**fail-open**：文件读不到、不是合法 JSON、或字段校验失败时，只写一条 warning 日志（`dsh-superagent: The declarative settings file …`），服务继续用已存设置启动。

理由：配置是给人改的，一个逗号不该让整个智能体停机。代价是"改了没生效"——所以排障第一条永远是看日志里那行 warning。面板仍显示实际生效的设置，可与文件对照。

## 6. 它为什么是后续工作的地基

- **多仓库/多账户**：先要能声明 N 个 Source，才谈得上跑 N 个。
- **策略可 review**：允许名单与规则进版本库之后，改动才有 diff 和评审。
- **可观测性对比**：配置是文件，才能把"某次改动 → 接单率变化"对应起来。

## 7. 尚未做

- 不支持热加载：改文件需重启服务。
- 不支持 YAML。
- 不写回：面板改动不会同步进文件（单向：文件 → 存储）。
- 未提供 JSON Schema 文件给编辑器自动补全（`pnpm typecheck` 与 `SettingsSchema` 是当前唯一的校验）。

## 8. 示例文件

仓库里有一份带占位符的模板：`windows-app/superagent.settings.example.json`。复制它、填好路径与账号，再把 `configPath` 指向你的副本即可。
