# Changelog

## 0.1.0 (2026-08-16)

首个可交付版本。

- 引擎：`ctx.skills` provider 注册；团队发现四层根（项目 `.dsh/experts` > 自定义 `teamDirs` > 用户 `<dshHome>/experts` > 随包 `teams/`），同名按 rank 就近覆盖。
- 校验：`team.json` 严格 schema（未知键拒绝、路径逃逸拒绝、恰好一位 coordinator、升级引用闭合、fail-loud 错误消息）；`scripts/validate-team.mjs` 离线校验 CLI。
- 组装：技能 body = review 工作流模板 + 花名册 + 人设卡内联（四反引号围栏）+ 升级矩阵 + TEAM.md 约定；发现结果 JSON Schema（保守子集）供 subagent `outputSchema` 使用。
- 示例团队：`web-review`（tech-lead 协调者 + 前端/后端/测试/安全，5 条升级路由）。
- 脚手架：`scripts/new-team.mjs --name <team> [--from <team|路径>] [--root <dir>]`。
- 测试：单元 + 宪法守护（`npm test` / `npm run guard`）。
