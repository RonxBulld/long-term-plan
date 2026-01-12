# long-term-plan：MCP Todo 管理小工具设计方案（v0）

## 1. 目标与约束

### 目标
- 用 **TypeScript** 编写一个 **MCP Server**，通过 **npx** 启动（stdio transport），提供 Todo 计划的增删改查。
- 面向 “数十到上千条任务、多个计划文件” 的规模，保证 **可读、可写、可检索、可扩展**。
- **数据的唯一事实来源**是结构化 Markdown 文件（可人读、可 diff、可 git 管）。
- 通过精心的内容格式与写入策略，尽量 **减少格式冲突**（尤其是 git merge 冲突与无谓大 diff）。

### 明确约束（按需求原文）
- 任务状态标记：
  - `[ ]`：未开始或未完成
  - `[*]`：进行中
  - `[√]`：已完成
- **非 MCP** 修改 Markdown 文件后：不保证一定能正确解析（工具可 “拒绝/报错/建议修复”，但不必须容错到任意 Markdown）。

### 非目标（v0 先不做或可选）
- 不把 Markdown 当数据库：不追求强一致 ACID、复杂查询语言、跨文件事务。
- 不承诺兼容任意第三方 Markdown 任务列表语法（例如 `[x]`、`- [ ]` 之外的变体）。

## 2. 仓库与文件布局（建议）

```
./.long-term-plan/           # 计划文件目录（默认 + 推荐）
  2026Q1.md
  product-roadmap.md
  config.json                # 可选：工具配置（是否提交到 git 由团队决定）
  index.json                 # 可选：加速索引缓存（建议 gitignore）
```

> 约定：`active-plan.md` 作为默认活动计划（`planId=active-plan`）。调用 plan/task/doc 工具时若省略 `planId`，默认操作该 plan；若文件不存在将自动创建（仅对省略 `planId` 生效，显式 `planId` 不会自动创建以避免拼写误创建）。

> 约定：所有写操作默认只允许发生在 `root` 下（防路径穿越）；并且只写 `plansDir`（默认 `.long-term-plan/`）。

## 3. Markdown 数据格式（long-term-plan-md v1）

### 3.1 文件级协议头（必需）
- 文件第一段（前若干行）必须包含协议声明：

```md
<!-- long-term-plan:format=v1 -->
```

### 3.2 章节（Section）
- 使用标准 Markdown 标题作为章节（推荐从 `##` 开始）：

```md
## 里程碑
### Sprint 1
```

- 工具以标题层级构建 `sectionPath`（例如 `["里程碑","Sprint 1"]`）。
- 标题文本允许人类编辑；**不作为稳定标识**（稳定引用依赖 taskId）。

### 3.3 任务行（Task Line）

#### 语法（必需满足）
任务必须是 “无序列表项 + 状态框 + 标题 + 行尾ID注释”：

```md
- [ ] 任务标题 <!-- long-term-plan:id=t_01HT... -->
```

- 无序列表符号：固定使用 `-`（工具写入时统一使用 `-`）。
- 状态标记：仅允许 `[ ]` / `[*]` / `[√]`。
- `taskId`：在行尾 HTML 注释中声明，键名固定为 `long-term-plan:id`。

#### taskId 规范（建议）
- 形如：`t_<ULID>`（例如 `t_01HT8Y2...`），全局唯一（跨文件也尽量唯一）。
- 只允许字符集：`[A-Za-z0-9_-]`，避免转义与编码差异。

#### 子任务（层级）
- 通过缩进与嵌套列表表达父子关系（工具规范写入：每层 **2 空格**）：

```md
- [ ] 父任务 <!-- long-term-plan:id=t_A -->
  - [ ] 子任务 <!-- long-term-plan:id=t_B -->
  - [√] 子任务2 <!-- long-term-plan:id=t_C -->
```

> 解析规则：仅把“符合任务行语法的列表项”识别为 Task；同层/子层的其他列表项视为注释与正文，保留但不结构化解析。

### 3.4 任务正文（可选、保留但不强解析）
允许在任务下方写说明、链接、普通列表项等（机器只做最小理解，写回时尽量原样保留）：

```md
- [*] 调研方案 <!-- long-term-plan:id=t_R -->
  - 背景：……
  - 链接：……
  - 风险：……
```

### 3.5 冲突最小化写入约束（关键）
为减少 merge 冲突与大 diff，写入策略遵循：
- **状态更新**：只替换任务行中的 `[...]` 三字符内容，不改动其余文本与缩进。
- **改标题**：只替换 `[...]` 后到 `<!-- long-term-plan:id=... -->` 前的“标题区域”，不改动注释与其后内容。
- **新增任务**：优先在目标 section 或父任务块末尾追加，避免全局重排；不进行自动排序。
- **删除任务**：删除该任务行 + 其缩进子块（直到缩进回退到同级/更浅）。
- **默认不格式化**：除非用户显式调用 `repair/format` 工具，否则不做“全文件规范化”。

### 3.6 “非 MCP 修改” 的定位
- 若文件缺少协议头、任务缺少 `taskId`、缩进结构无法判定、出现未知状态标记等：
  - 读操作：可返回 `PARSE_ERROR`（包含可定位的行号范围与原因）
  - 写操作：默认拒绝（避免把错误写深）
  - 提供 `doc.validate` / `doc.repair` 工具做显式修复

## 4. 核心实现策略（可测/可维护）

### 4.1 解析：线性、行级、可定位
- 不依赖“完整 Markdown AST”，而是实现一个 **行级解析器**：
  - 识别 headings（`^#{1,6} `）
  - 识别任务行（regex + 行尾 `long-term-plan:id`）
  - 用缩进栈构建树
  - 为每个 task 记录 `lineStart/lineEnd` 与 `indent`，支持最小文本补丁
- 好处：性能可控、错误定位清晰、写回更容易做到 “最小 diff”。

### 4.2 写入：原子化 + 乐观并发控制
- 每次读返回 `etag`（例如 `sha256(fileText)`）。
- 写操作要求客户端携带 `ifMatch`：
  - 若 `etag` 不匹配，返回 `CONFLICT`（提示重新读取后再提交）
- 写文件采用 “临时文件 + rename” 的原子替换（同目录内）避免半写入。

## 5. MCP Server 形态（npx 启动）

### 5.1 命令形式（建议）
- 包名（示例）：`long-term-plan-mcp`
- 启动命令：
  - `npx long-term-plan-mcp --root . --plans .long-term-plan`（默认可省略 `--plans`）
- 传输：stdio（符合 MCP 常见部署方式）

### 5.2 配置加载优先级
1) CLI 参数
2) `.long-term-plan/config.json`
3) 默认值：`root=process.cwd()`，`plansDir=.long-term-plan`

## 6. MCP 工具接口（CRUD + 校验）

> 命名建议：用 `plan.*` / `task.*` / `doc.*` 分组，避免未来扩展冲突。

### 6.1 Plan（计划文件）
- `plan.list({ query?, limit?, cursor? }) -> { plans: PlanSummary[], nextCursor? }`
- `plan.get({ planId, view?: "tree"|"flat", limit?, cursor? }) -> { plan, etag, nextCursor? }`
- `plan.create({ planId?, title, template?: "empty"|"basic" }) -> { planId, path }`

PlanSummary（示例）
```json
{
  "planId": "product-roadmap",
  "title": "Product Roadmap",
  "path": ".long-term-plan/product-roadmap.md",
  "stats": { "total": 120, "todo": 80, "doing": 3, "done": 37 }
}
```

### 6.2 Task（任务）
- `task.get({ planId?, taskId? }) -> { task, etag }`
- `task.add({ planId, title, status?, sectionPath?, parentTaskId?, ifMatch }) -> { taskId, etag }`
- `task.update({ planId?, taskId?, status?, title?, allowDefaultTarget?, ifMatch }) -> { etag, taskId }`
- `task.delete({ planId, taskId, ifMatch }) -> { etag }`
- `task.search({ query, status?, planId?, limit?, cursor? }) -> { hits: TaskHit[], nextCursor? }`

默认行为：
- 省略 `planId`：使用当前活动 plan（`active-plan`）
- 省略 `taskId`：优先选择第一个 `doing`；若没有 `doing`，则选择从上往下第一个未完成任务

写操作安全阀（推荐）：
- `task.update` 若省略 `taskId`：必须显式设置 `allowDefaultTarget=true`，并提供 `ifMatch`（etag）以避免“目标漂移”

状态枚举（建议输出值）
```json
{ "status": "todo" | "doing" | "done" }
```
写回映射：
- `todo` -> `[ ]`
- `doing` -> `[*]`
- `done` -> `[√]`

### 6.3 Doc（格式校验/修复）
- `doc.validate({ planId? }) -> { errors: Diagnostic[], warnings: Diagnostic[] }`
- `doc.repair({ planId, actions: RepairAction[], dryRun?: boolean, ifMatch? }) -> { etag, applied }`

RepairAction（建议先做最小集合）
- `addMissingIds`：为缺少 `long-term-plan:id` 的任务行补齐（需要严格规则，避免误判）
- `normalizeIndent`：把任务层级缩进统一为 2 空格（可选，容易产生大 diff，默认不做）
- `normalizeStatusChar`：把 `[x]`/`[X]` 之类（若存在）转换为 `[√]`（可选）

## 7. 关键边界与防御性设计（多层校验）

1) **入口校验（MCP 参数）**：planId/path 只允许相对路径与白名单目录；拒绝 `..`、绝对路径。
2) **文件级校验**：协议头、编码（UTF-8）、行结束符兼容（`\n`/`\r\n`）。
3) **结构级校验**：taskId 唯一、缩进层级合法、状态字符合法。
4) **写入级防护**：`etag ifMatch` 冲突检测 + 原子写入，避免并发覆盖与部分写入。

## 8. 可扩展点（v1+）
- 任务属性：`due`、`tags`、`estimate` 等（建议继续放行尾注释中，如 `<!-- long-term-plan:id=... tags=a,b -->`，并保持 key=value 简单语法）。
- 依赖关系：`depends=t_xxx`，以及 “阻塞/被阻塞” 的查询工具。
- 工作流：`task.start` 可选 “同一 plan 仅允许一个 doing” 的策略开关。
- 索引缓存：`.long-term-plan/index.json`（只做加速，不作为事实来源）。

## 9. 测试建议（保证可测）
- `parse(text) -> DocModel` 纯函数：覆盖缩进、章节、混合正文、非法行的测试夹具。
- `applyEdit(text, op) -> { newText, changedRanges }`：断言最小 diff（只改目标行）。
- fixtures/golden：用真实的 `.long-term-plan/*.md` 样例做快照测试。
