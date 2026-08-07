# 新装 Skills 使用速查手册

> 安装日期：2026-08-07 ｜ 安装位置：`C:\Users\syzh1\AppData\Local\hermes\skills\`
> 来源：superpowers(obra) + UI-UX-Pro-Max(nextlevelbuilder) + CodeGraph(kaplar1) + code-ai-review(自建)

---

## 一、superpowers（14 个子 skills）

> 来自 `obra/superpowers`，agentic 开发工作流框架。核心思想：**先探索 → 再计划 → 再执行 → 再验证**。

| Skill | 触发时机 | 一句话作用 |
|:---|:---|:---|
| `using-superpowers` | 任何会话开始 | 总入口，规定"先调 skill 再回答"的纪律 |
| `brainstorming` | 任何创造性工作前 | **必须先做**。探索用户意图/需求/设计，再动手编码 |
| `writing-plans` | 有了需求、准备写多步任务前 | 把需求拆成可执行计划 |
| `executing-plans` | 有了书面计划、要独立执行 | 带检查点的分会话执行 |
| `subagent-driven-development` | 执行计划中有独立子任务 | 派发子代理并行开发 |
| `dispatching-parallel-agents` | 有 2+ 个无依赖任务 | 并行派发多个代理 |
| `test-driven-development` | 写代码前 | 强制 RED-GREEN-REFACTOR |
| `systematic-debugging` | 遇到 bug/测试失败 | 4 阶段根因调试（先找根因再修） |
| `requesting-code-review` | 完成任务/合并前 | 派发代码审查子代理 |
| `receiving-code-review` | 收到审查反馈 | 严谨验证反馈，不盲从 |
| `verification-before-completion` | 声称"完成了"之前 | 先跑验证命令再下结论（先证据后断言） |
| `using-git-worktrees` | 需要隔离工作区 | 建独立工作树 |
| `finishing-a-development-branch` | 实现完成、测试通过 | 决定如何整合分支 |
| `writing-skills` | 创建/编辑 skill | 规范 skill 编写 |

> ⚠️ **注意**：`requesting-code-review`、`systematic-debugging`、`test-driven-development` 因与你本地增强版重名，**保留的是 Hermes 增强版**（在 `software-development/` 分类下），功能更完整，不是上面的原始版。

---

## 二、UI-UX-Pro-Max（7 个子 skills）

> 来自 `nextlevelbuilder/ui-ux-pro-max-skill`。本地搜索数据库：84 风格 / 192 色板 / 74 字体配对 / 192 产品类型 / 98 UX 规则 / 104 图标 / 16 GSAP 动效 / 25 图表类型，覆盖 22 技术栈。

| Skill | 作用 |
|:---|:---|
| `ui-ux-pro-max` | **核心**。设计智能，按优先级给规则建议 |
| `banner-design` | 社交媒体/广告/网页 hero/印刷 banner 设计 |
| `brand` | 品牌声音、视觉识别、信息框架 |
| `design` | 综合设计：logo、CIP、mockups、图标、社交图 |
| `design-system` | 设计 token 架构（primitive→semantic→component）、CSS 变量 |
| `slides` | HTML 演示文稿（Chart.js + 设计 token） |
| `ui-styling` | shadcn/ui + Tailwind 界面实现、暗色模式 |

### 核心用法（ui-ux-pro-max）

```bash
# 1. 生成完整设计系统（新页面/新项目必做）
python "C:\Users\syzh1\AppData\Local\hermes\skills\ui-ux-pro-max\scripts\search.py" "<产品类型> <行业> <关键词>" --design-system -p "项目名"

# 2. 持久化设计系统到项目根目录
python "...\search.py" "<关键词>" --design-system --persist -p "项目名" --output-dir "<项目根目录>"

# 3. 定向深挖某个维度
python "...\search.py" "<关键词>" --domain <domain>
# domain: style / color / typography / chart / ux / landing / icons / gsap / react / web / product

# 4. 技术栈专属建议
python "...\search.py" "<关键词>" --stack <stack>
# stack: react / nextjs / vue / svelte / electron兼容(html-tailwind) 等 22 种

# 5. 设计旋钮（调整风格/动效/密度）
python "...\search.py" "<关键词>" --design-system --variance 8 --motion 7 --density 8
```

> ⚠️ **路径修正**：原版引用 `${CLAUDE_PLUGIN_ROOT}/.claude/skills/`，你本地实际路径是 `C:\Users\syzh1\AppData\Local\hermes\skills\`。用上面绝对路径即可。

---

## 三、codegraph（1 个）

> 来自 `kaplar1/CodeGraph`。用确定性静态分析（正则，无 LLM 调用，快且免费）生成代码库依赖图。

```bash
# 1. 生成文件级依赖图 (最快, 默认)
python "C:\Users\syzh1\AppData\Local\hermes\skills\codegraph\scripts\build_graph.py" . --out .knowledge-graph

# 2. 加函数/类级节点 (更详细)
python "...\build_graph.py" . --out .knowledge-graph --functions

# 3. C/C++ 调用图
python "...\build_graph.py" src/main.c --out .knowledge-graph --calls

# 4. 渲染可视化 dashboard
python "...\render_dashboard.py" .knowledge-graph/knowledge-graph.json --out .knowledge-graph/dashboard.html
```

**产物**：
- `knowledge-graph.json` — 机器可读图（节点=文件/函数/类，边=import/define/calls）
- `ARCHITECTURE.md` — 人类/AI 可读摘要（先读这个）
- `dashboard.html` — 单文件交互可视化（力导向图，可分享）

**依赖**：纯 Python 标准库，无外部包。**语言覆盖**：Python 最准、C/C++ 次之、JS/TS 只解析相对导入、Go/Java/Ruby/Rust 轻量启发式。

---

## 四、code-ai-review（1 个，自建）

> GitHub 无同名仓库，我基于 superpowers 的 requesting-code-review 概念创建，整合安全/质量/正确性/性能四维度。

**触发**：审查代码 / AI review / 代码质量检查 / 提交前检查 / PR评审 / 找bug / 安全扫描

**四维度优先级**：
1. 🔴 **安全**（最高）：SQL注入、硬编码密钥、命令注入、路径遍历、敏感数据泄露
2. 🟡 **正确性**：空值/undefined、缺 await、边界条件、资源泄漏
3. 🟢 **质量**：重复代码、死代码、命名、嵌套深度
4. 🔵 **性能**：N+1 查询、重复计算、大对象拷贝、未分页查询

**医疗红线**（针对你的环境）：患者信息/内部数据脱敏、生产数据/密码/Token 提醒脱敏、数据库高危操作二次确认。

**配合使用**：
- 提交前完整审查 → `requesting-code-review`（增强版）
- 系统化调试 → `systematic-debugging`（增强版）
- 安全修复 → `sql-injection-remediation`

---

## 五、推荐协作工作流

```
新功能/新需求
   │
   ├─ brainstorming          ← 先探索意图，别急着写码
   ├─ writing-plans          ← 拆计划
   ├─ [UI 相关?] ui-ux-pro-max  ← 生成设计系统
   ├─ test-driven-development  ← 测试先行
   ├─ subagent-driven-development / dispatching-parallel-agents  ← 并行开发
   ├─ [想画架构图?] codegraph  ← 生成代码库依赖图
   ├─ requesting-code-review  ← 提交前审查
   ├─ verification-before-completion  ← 验证再宣称完成
   └─ finishing-a-development-branch  ← 整合分支
```

---

## 六、常见问题

| 问题 | 解决 |
|:---|:---|
| ui-ux-pro-max 报找不到脚本 | 用绝对路径 `C:\Users\syzh1\AppData\Local\hermes\skills\ui-ux-pro-max\scripts\search.py` |
| 同名 skill 冲突 | 已处理：3 个保留增强版，其余 11 个用 superpowers 原版 |
| codegraph 想画别的语言 | 查 `codegraph/TESTING.md`，有 smoke test 可先行验证 |
| 想删掉某个 skill | 直接删对应目录即可，或告诉我处理 |