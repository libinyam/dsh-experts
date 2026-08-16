# dsh-experts

[![CI](https://github.com/libinyam/dsh-experts/actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)
[License: MIT](LICENSE)

DeepSeek Harness（dsh）的多专家插件：把「专家团」做成用户可写的数据目录，每个团队自动注册为模型可路由的 skill（`experts-<团队名>`）。引擎与阵容分离——团队发现、校验和工作流协议在插件里，专家人设与升级路由在团队目录里。

设计参照 Qoder 专家团 / WorkBuddy Expert Teams 的产品形态，协作协议继承自 [github-project-review-skill](https://github.com/libinyam/github-project-review-skill) 的已验证机制（升级路由矩阵、数据门控决策、分层输出深度），并全部改建于 dsh 原生能力（skills provider、可继续 child、嵌套 subagent、消息和 report 通道）之上。

## 工作原理

```
团队目录（数据）                        dsh-experts 插件（引擎）
┌─ <projectRoot>/.dsh/experts/  rank 100 ┐
├─ config.teamDirs              rank 300 │→ 发现 → team.json 严格校验（fail loud）
├─ <dshHome>/experts            rank 400 │→ 组装 → 工作流模板 + 花名册 + 人设卡
└─ 随包 teams/（示例团队）      rank 600 ┘        + 升级矩阵 + TEAM.md 约定
                                              ↓
                            skill 目录出现 experts-<团队名>，模型按 whenToUse 路由
                                              ↓
                            当前会话启动真实 lead child
                                      ↓
                            lead 按任务动态启动 specialist child
                            （相关专家才启动，可继续/追加派遣）
```

同名团队按 rank 就近覆盖（项目 > 自定义 > 用户 > 随包），魔改官方示例的标准动作：把示例目录拷到 `<dshHome>/experts/` 下改。

## 安装

### 方式一：加入 dsh profile（推荐）

在 profile 的 `package.json` 中把本包加入依赖与 bundles：

```json
{
  "dependencies": {
    "dsh-experts": "github:libinyam/dsh-experts"
  },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-experts"]
    }
  }
}
```

本地开发可用 `"dsh-experts": "file:<到本仓库的路径>"`。

### 方式二：手动放置

克隆本仓库到 profile 的 `node_modules/dsh-experts`，并把 `"dsh-experts"` 追加进 bundles 列表（无外部依赖，无需安装步骤）。

## 快速开始

1. **用示例团队**：安装后 skill 目录会出现 `experts-web-review`（5 位专家：协调者 tech-lead + 前端 + 后端 + 测试 + 安全）。对 dsh 说：

   > 用 experts-web-review 评估 owner/repo 的推广就绪度

2. **创建你自己的团队**：

   ```bash
   node node_modules/dsh-experts/scripts/new-team.mjs --name my-team
   # 默认从内置 web-review 复制到 <dshHome>/experts/my-team
   ```

   编辑 `my-team/team.json`（描述、专家、升级路由）和 `experts/*.md` 人设卡，然后校验：

   ```bash
   node node_modules/dsh-experts/scripts/validate-team.mjs <dshHome>/experts/my-team
   ```

   校验通过后 skill 目录自动多出 `experts-my-team`（新增/修改团队后需重载插件使目录刷新）。

## 团队格式

```
my-team/
├── team.json     # 机器接线：名称/描述/工作流/专家/升级路由
├── TEAM.md       # 团队级约定（可选，注入技能 body）
└── experts/      # 人设卡，由 lead 在 specialist prompt 中全文注入
    ├── lead.md
    └── coder.md
```

`team.json` 字段（未知字段会被拒绝，拼写错误立即暴露）：

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | ✓ | kebab-case，必须与目录名一致；技能名为 `experts-<name>` |
| `description` | ✓ | 技能目录中的一句话描述（≤500 字符） |
| `whenToUse` |  | 路由提示 |
| `workflow` | ✓ | 工作流模板名，v0.1 仅 `review` |
| `experts[]` | ✓ | 1-8 位；`{id, role: coordinator\|specialist, card, modelHint?}`；恰好一位 coordinator（作为 lead child 启动）；card 必须是团队目录内的相对路径 |
| `escalations[]` |  | `{from, to, when, priority: P0\|P1\|P2}`；from/to 必须引用专家 id，不许自指 |
| `reportLanguage` |  | `zh`（默认）或 `en` |

校验规则全部会红：未知键、路径逃逸（`..`/绝对路径/盘符前缀/符号链接出目录/NUL 字节）、缺失卡片、悬空升级引用、多位协调者、自由文本字段含换行或管道符（防 markdown 结构注入）、卡片含 4+ 反引号围栏行、TEAM.md 超 64KB……错误消息带精确文件路径与字段名。同名团队先按名字去重再对胜者全量校验——有效的低 rank 团队可以遮蔽同名的坏团队；没有遮蔽时任何坏团队都会让本提供方报错。

## 配置（cordis.patch.yml，全部可选）

| 键 | 默认 | 说明 |
|---|---|---|
| `providerName` | `dsh-experts` | skills 注册表中的提供方名 |
| `includeDefaultRoots` | `true` | 是否扫描项目/用户根（关闭后仅 teamDirs + 随包） |
| `dshHome` | `$DSH_HOME` 或 `~/.dsh` | 覆盖 dsh 主目录 |
| `teamDirs` | `[]` | 额外团队根（rank 300） |
| `includeBundledTeams` | `true` | 是否暴露随包示例团队 |

环境变量：`DSH_EXPERTS_PROVIDER_NAME`、`DSH_EXPERTS_INCLUDE_DEFAULT_ROOTS=0`、`DSH_HOME`、`DSH_EXPERTS_TEAM_DIRS`（分号/逗号分隔）、`DSH_EXPERTS_INCLUDE_BUNDLED_TEAMS=0`。

## 开发

```bash
npm test                        # 全量测试（单元 + 守护）
npm run guard                   # 只跑宪法守护测试
npm run validate-team teams/web-review   # 校验内置示例团队
```

零运行时依赖、零 devDependencies；Node ≥18；plain ESM JavaScript 无构建步骤。工程约定见 [CLAUDE.md](CLAUDE.md)（宪法：每条约定都标注"违反时什么会红"）。

## 运维路径

- **插件没生效/团队没出现**：dsh 控制台日志看 `skills.registerProvider` 相关错误；最常见原因是某个团队 `team.json` 校验失败——错误消息自带文件路径与字段，修掉即可；或跑 `scripts/validate-team.mjs <目录>` 离线定位。
- **改了团队没生效**：v0.1 无文件 watcher，重载插件（重启会话或触发插件重载）。
- **专家派遣失败**：看 lead 的调度记录；无 subagent 或 report 工具时必须明确标记团队运行时不可用，不得伪装成专家已经工作。
- **确定性排查**：`list()`/`get()` 的行为由 `src/teams.js` 覆盖测试锁定（层级、rank、契约形状）。

## 已知问题（v0.1）

- 无文件 watcher：新增/修改团队需重载插件。
- 每次 `list()` 全量重扫并重校验所有团队（无缓存）；团队数量上千时目录刷新开销可观。
- 仅 `review` 工作流模板；`develop` 模板（patch 化输出 + 绿灯门禁 + 人工 PR）在路线图上。
- 未扫描 `.agents` 系根目录（`.dsh` 覆盖项目与用户两层）。
- `modelHint` 只是模板提示，不强制路由模型。
- `FINDINGS_SCHEMA` 使用保守 JSON Schema 子集，当前作为 specialist prompt 的文本协议，不是每次 subagent 调用的结构化输出参数。
- 一个坏团队（且无低 rank 同名遮蔽）会让本提供方整体报错（fail loud 设计）；修复该团队即恢复。

## License

MIT
