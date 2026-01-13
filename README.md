# long-term-plan-mcp

一个基于 **Model Context Protocol (MCP)** 的 stdio Server，用来管理“数十到上千条”的 Todo 计划，数据存储在 **结构化 Markdown** 中。

## 快速开始（本地）

```bash
npm install
npm run build
node dist/cli.js --root . --plans .long-term-plan
```

> 作为 MCP server 通常由宿主（IDE/Agent）启动；本项目默认使用 stdio transport。

## long-term-plan-md v1（Markdown 约定）

文件必须包含协议头：

```md
<!-- long-term-plan:format=v1 -->
```

任务行必须带稳定 ID（行尾注释），并使用固定状态符号：

```md
- [ ] 未完成 <!-- long-term-plan:id=t_xxx -->
- [*] 进行中 <!-- long-term-plan:id=t_yyy -->
- [√] 已完成 <!-- long-term-plan:id=t_zzz -->
```

支持层级任务（2 空格缩进）与章节（Markdown headings）。默认计划文件目录为 `.long-term-plan/`（可用 `--plans` 覆盖）。

约定：所有 plan/task/doc 工具调用都必须显式提供 `planId`；本项目不再提供“省略 `planId` 的隐式默认计划”语义。
调用 `task.get` 时若省略 `taskId`，默认返回第一个进行中（`doing`）任务；若没有进行中任务，则返回从上往下第一个未完成任务。
调用 `task.update` 时也可省略 `taskId`，但必须同时提供 `ifMatch` 并设置 `allowDefaultTarget=true`（避免误改）。

## MCP Tools

- `plan.list` / `plan.get` / `plan.create`
- `task.get` / `task.add` / `task.update` / `task.delete` / `task.search`

## 重要行为保证

- 任何“写入类” tool 返回成功后：写入落盘的 Markdown 仍满足 `long-term-plan-md v1`，因此同版本解析器一定可解析。
- 对“非 MCP 修改”的文件：可能无法解析；此时写入类操作默认拒绝，需手工修复为合法 `long-term-plan-md v1` 格式后再操作。

兼容性：可通过 `--legacy-doc-tools` 额外注册旧的 `doc.validate`/`doc.repair` 工具（默认不导出 `doc.*`，也不导出任何 validate/repair 工具）。
