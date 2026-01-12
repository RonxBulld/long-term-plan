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

约定：默认活动计划文件为 `.long-term-plan/active-plan.md`（`planId=active-plan`）。调用 MCP tools 时若省略 `planId`，默认操作该 plan；若文件不存在将自动创建。

## MCP Tools

- `plan.list` / `plan.get` / `plan.create`
- `task.get` / `task.add` / `task.setStatus` / `task.rename` / `task.delete` / `task.search`
- `doc.validate` / `doc.repair`

## 重要行为保证

- 任何“写入类” tool 返回成功后：写入落盘的 Markdown 仍满足 `long-term-plan-md v1`，因此同版本解析器一定可解析。
- 对“非 MCP 修改”的文件：可能无法解析；此时写入类操作默认拒绝，需先 `doc.validate`/`doc.repair` 显式修复。
