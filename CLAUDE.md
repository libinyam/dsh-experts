# dsh-experts 宪法

本文件是这个项目的最高工程约定。每次会话动手前先读本文件；宪法与代码冲突时，要么改代码，要么显式修订宪法并说明理由——不许静默偏离。

## 业务红线（违反即回滚，没有例外）

1. **不猜 harness API**。与 DeepSeek Harness 的每一个接点（服务名、方法签名、能力 flag、rank 语义）必须有 deepseek-harness 源码出处。本文件末尾的「接点台账」记录已验证接点及其出处；新接点先验证、记台账、再使用。查不到出处的能力：降级到已验证路径，或阻塞并告知用户，绝不臆测字段名。
2. **Fail loud，不静默降级**。任何无效输入（坏 team.json、丢失卡片、非法路径）必须抛出带 `code` 的错误，消息包含精确文件路径和原因。禁止：吞错后跳过、把无效团队静默从目录里消失、把「未采集」记成零分。用户修一个坏团队时，报错必须能一次定位到字段。
3. **团队是数据，不是代码**。引擎永不执行团队目录里的任何可执行内容；团队配置只允许结构化字段（见 manifest.js 的 schema）。不向团队开放自定义脚本/工作流代码——这条不因功能需求而放松，除非单独立项修订。
4. **引擎只读**。src/ 下的发现、校验、组装逻辑对文件系统只做读操作；唯一例外是 scripts/ 下用户显式执行的脚手架 CLI。引擎不做网络访问、不写任何文件。
5. **路径即边界**。团队清单里所有文件引用（card 等）必须在团队目录内解析。逃逸（`..`、绝对路径、符号链接出目录）一律拒绝。违反它的测试必须存在且保持红敏感。

## 技术硬约定

| 约定 | 违反时什么会红 |
|---|---|
| 零运行时依赖、零 devDependencies；只用 Node 标准库 | guard: package.json 的 dependencies/devDependencies 非空即 fail |
| Plain ESM JavaScript，无构建步骤，无 TypeScript | guard: src/ 出现 .ts 文件或 tsconfig.json 即 fail；import 语法错误由 import 冒烟测试红 |
| Node >= 18 可运行（开发机 v24） | engines 字段 + CI 的 node 矩阵 |
| 所有抛错走 errors.js 的 `pluginError(msg, code, details)`，code 为稳定大写蛇值 | 代码评审清单 + guard: src/ 内 `throw new Error(` 直接出现即 fail |
| 错误码词汇表是 errors.js 导出的 `ERROR_CODES`（单一事实源） | guard: 双向同步扫描——用了未声明的码、声明了未用的码都红 |
| manifest 校验拒绝未知字段（拼写保护）、拒绝路径逃逸（含 Windows 盘符前缀与 NUL）、强制恰好一个 coordinator；内联进技能 body 的自由文本字段必须单行且不含管道符；卡片不得含 4+ 反引号围栏行 | tests/manifest.test.js 对应反例必须红 |
| 发现层级 rank：project(100) < custom(300) < user(400) < bundled(600)，同名团队低 rank 覆盖（先读名去重，再对胜者全量校验——有效低 rank 团队可遮蔽同名坏团队） | tests/teams.test.js 层级覆盖与遮蔽用例 |
| 组装出的技能 body 必须含：花名册表、每专家人设卡围栏块、升级矩阵表、工作流模板、团队约定五节 | tests/compose.test.js 断言各节存在 |
| 专家发现协议只用保守 JSON Schema 子集（type/properties/items/required/additionalProperties/enum），作为 prompt 文本协议传给 specialist | 模板内 schema 由 tests/compose.test.js 解析断言子集 |
| src/ 禁 console.log（CLI 脚本除外） | guard: grep src/ 中 console. 即 fail |
| 文本文件 LF、UTF-8、两空格缩进 | .editorconfig + .gitattributes；guard 冒烟检查 BOM |

## 产品路线（已拍板）

- v0.1（本版）：lead-first review 工作流模板 + web-review 示例团队（1 个 lead + 4 个按需 specialist）+ 团队校验 CLI + 脚手架 CLI + bundle 注册。
- 明确不做（写入已知问题，防止顺手做出）：develop 工作流模板、文件 watcher（新增团队需重载插件）、`.agents` 系根目录、按专家强制模型路由（v0.1 仅模板提示）、团队市场/远程安装。
- 专家团运行时依赖 dsh 原生 `subagent`、`list_agents`、`send_message` 和 child-scoped `report`；lead 是真实 child，specialist 由 lead 按需启动。部署未装载这些能力时必须标记团队运行时不可用，禁止伪装成专家已执行。

## 接点台账（已验证的 harness 接点及出处）

| 接点 | 事实 | 出处（deepseek-harness@master, 2026-08-16） |
|---|---|---|
| 插件形态 | `export const name` / `inject` / `apply(ctx, config)`，cordis patch `insert:` 条目注册，config 即插件配置 | docs/user/develop/basic/index.zh.md；dsh-vision-provider 实例 |
| skills 服务 | 服务名 `'skills'`，`inject = ['skills']` | packages/skill/skill/src/index.ts `SkillRegistry extends Service`，`super(ctx, 'skills')` |
| provider 注册 | `ctx.skills.registerProvider(create)`，create 收 `{signal, invalidate}` 返回 provider，效应域自动清理，层内重名抛错 | 同上文件 `registerProvider`（L391 起） |
| SkillProvider 契约 | `{name, list(options) -> candidates\|observation, get(candidate, options) -> definition\|undefined}` | 同上 + docs/subsystems/skills.zh.md |
| SkillCandidate 字段 | name(kebab)/description/whenToUse?/invocation/source/provider/resourceBase?/rank/locator/path?/metadata? | packages/skill/skill/src/index.ts 类型定义 |
| rank 语义 | 层内重名低 rank 胜；既有惯例 100/200/300/400/500/600 | skill-filesystem/src/index.ts 常量；BUNDLED_SKILL_RANK=600 |
| dshHome 解析 | `$DSH_HOME` 或 `~/.dsh` | skill-filesystem 引用 dsh-home-paths resolveDshHome |
| 项目根 | 含 `.git` 的最近祖先目录 | docs/subsystems/skills.zh.md「本地发现优先级」 |
| subagent 工具 | `subagent` 支持 `description`/`prompt`/`run_in_background`；可继续模式返回持久 child id；子 agent 可嵌套委派 | packages/subagent/tool-subagent/src/index.ts；packages/subagent/subagent/README.zh.md |
| subagent 控制 | `list_agents` 枚举可继续 child，`send_message` 继续同一 child，child-scoped `report` 以 wakeup 消息回传父级 | packages/subagent/tool-subagent-control/src/list-agents.ts；packages/subagent/tool-subagent-control/src/index.ts；packages/subagent/tool-subagent-report/src/index.ts |

台账行新增时必须附出处；发现源头变更（harness 破坏性更新）时，先更新台账再改代码。
