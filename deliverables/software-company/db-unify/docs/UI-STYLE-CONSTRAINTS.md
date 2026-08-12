# UI 设计风格约束（深空科技 Deep-Space）

> **文档版本**: v1.0
> **定稿日期**: 2026-08-12
> **适用范围**: 本仓库 `deliverables/software-company/db-unify/` 前端全部组件
> **实现基准**: `src/theme.ts`（MUI createTheme 主题，v1.6 深空科技升级）
> **说明**: 本文档将 DClaw 前端 UI 的**硬约束、设计 token、交互规范**汇总为单一清单，供开发/评审/交付统一遵循。带 ⚠️ 为**必须遵守的红线**，带 🕐 为**已变更/演进中**的约束。

---

## 1. 设计定位

| 维度 | 约束 | 说明 |
|------|------|------|
| 风格 | **深空科技**（Deep-Space）| 深色渐变底 + 数据蓝 + 金橙，精致现代 |
| 基调 | 数据工具专业感 | 医疗数据场景，庄重不花哨 |
| 关键平衡 | ⚠️ **数据区清晰优先** | 表格/编辑器保持高对比，**不做全玻璃化** |
| 国际化对标 | Dark Mode + Material 3 圆角 + 柔和阴影 | 参考 Linear / VS Code Dark / DBeaver |

---

## 2. ⚠️ 颜色 Token（唯一来源：`src/theme.ts`）

> **铁律**：组件内**禁止硬编码 hex**，一律引用 `theme.palette` token。此约束已在 P0 审计中强制执行（180+ 处硬编码已替换）。

### 2.1 语义色板（dark 主分支）

| Token | 值 | 用途 |
|-------|-----|------|
| `primary.main` | `#0084C8` | 主操作、链接、选中强调 |
| `primary.light` | `#4FC3F7` | hover/激活亮蓝、图标 |
| `primary.dark` | `#2DA0D0` | 渐变深端、按下 |
| `secondary.main` | `#D4A72C` | SQL 关键字金橙、次要强调 |
| `error.main` | `#F87171` | 错误、危险操作 |
| `warning.main` | `#FFB020` | 警告 |
| `success.main` | `#4ADE80` | 成功、在线状态 |
| `info.main` | `#4FC3F7` | 信息 |
| `background.default` | `#0F1418` | 主背景（深空） |
| `background.paper` | `#141A1F` | 面板/卡片背景 |
| `text.primary` | `#D5DCE3` | 主文字 |
| `text.secondary` | `#8AA0AD` | 次要文字/提示 |
| `text.disabled` | `#5A6B78` | 禁用文字 |
| `divider` | `#22303A` | 分割线/边框 |

### 2.2 状态色（action）

| Token | 值 |
|-------|-----|
| `action.hover` | `rgba(255,255,255,0.06)` |
| `action.selected` | `rgba(79,195,247,0.15)` |
| `action.focus` | `rgba(79,195,247,0.20)` |
| `action.active` | `rgba(79,195,247,0.18)` |

### 2.3 边框/线

- ⚠️ 一律用 `divider`（`#22303A`）或 `rgba(255,255,255,0.08)`，**禁止散落硬编码边框色**
- 不用纯黑边框（太硬）

---

## 3. ⚠️ 圆角（shape）

| 元素 | 圆角 | 说明 |
|------|------|------|
| 全局 `shape.borderRadius` | **8px** | 默认基准 |
| 面板/卡片 | **10px** | 大面板 |
| 弹窗 Dialog | **12px** | 浮层最圆 |
| 输入框/按钮 | **8px** | 标准控件 |
| 数据表格单元格 | **4-6px** | ⚠️ 保持紧凑，不过度圆角 |
| 菜单/下拉 | **8px** | |
| Tooltip/Chip | **6px** | 小控件 |

> ⚠️ 圆角**不得超过 12px**，避免损失数据工具的专业感/紧凑感。

---

## 4. 阴影（柔和分层）

> ⚠️ 阴影必须**柔和、分层**，禁止黑/硬阴影。实现：`src/theme.ts` 的 `shadowLayer` + 25 级 `SPACE_SHADOWS`。

| 层级 | 示例 | 用途 |
|------|------|------|
| 卡片 elevation2 | `0 6px 2px rgba(0,0,0,0.32)` | 常规卡片 |
| 浮层 elevation4 | `0 14px 6px rgba(0,0,0,0.38)` | 菜单/下拉 |
| 抽屉 elevation8 | `0 32px 14px rgba(0,0,0,0.50)` | 侧滑/大浮层 |

---

## 5. 渐变

> 主按钮/成功/警告/危险均用 **135deg 线性渐变**（深→浅端），增强精致感。

| 语义 | 渐变 |
|------|------|
| 主按钮 primary | `linear-gradient(135deg, #0084C8 0%, #2DA0D0 100%)` |
| 主按钮 hover | `linear-gradient(135deg, #1B95D8 0%, #3FB0DE 100%)` |
| 成功 | `linear-gradient(135deg, #22C55E 0%, #4ADE80 100%)` |
| 危险 | `linear-gradient(135deg, #DC2626 0%, #F87171 100%)` |
| 警告 | `linear-gradient(135deg, #D97706 0%, #FFB020 100%)` |
| 金橙 secondary | `linear-gradient(135deg, #D4A72C 0%, #E0C077 100%)` |

> 背景渐变：极轻微 `rgba(255,255,255,0.018~0.025)` 向下渐变，不喧宾夺主。

---

## 6. 过渡 / 动效

| 属性 | 值 | 说明 |
|------|-----|------|
| 全局过渡 | `150ms ease` | background-color/color/border-color/box-shadow |
| 按钮 hover | 提亮 + 微上浮 + 阴影增强 | `transform 150ms ease` |
| 表格行 hover | 背景平滑过渡 | |
| 卡片 hover | 阴影增强 | |
| entering | `200ms` | 进入动画 |
| leaving | `160ms` | 退出动画 |
| easing | `cubic-bezier(0.4,0,0.2,1)` | 标准缓动 |

> ⚠️ 过渡**只作用于主要交互组件**，不覆盖 MUI 内部 transform/opacity 动画，避免冲突。

---

## 7. ⚠️ 字号体系（4 层 + scale 缩放）

> **铁律**：字号只用 4 层，**禁止 0.5 步碎值**（如 10.5/11.5/12.5）。全部用 `calc(rem * var(--dc-scale, 1))` 跟随缩放。

| 层级 | 值 | 用途 |
|------|-----|------|
| 标题 T1 | `0.95rem` + fontWeight 600 | 面板标题/弹窗标题 |
| 内容 T2 | `0.85rem` | 正文/表头 |
| 次要 T3 | `0.75rem` | 次级内容 |
| 提示 T4 | `0.7rem` | 注释/状态 |

> **字体基准**：`src/theme.ts` `baseFontSize=12`、`htmlFontSizePx=Math.round(15*scale)`（默认 15px）。所有 rem 以 `htmlFontSizePx` 为分母转换，随 scale（40%-150%，11 档）同步缩放。
>
> ⚠️ 字体栈含 **CJK fallback**（微软雅黑/思源黑体等），弹窗内部强制 CJK 字体。

---

## 8. ⚠️ 紧凑度铁律

| 元素 | 约束 |
|------|------|
| 树行 | minHeight 18-22px，py 0.15，lineHeight 1.2，缩进 12-14px |
| 图标 | 最小 11-13px |
| 字号最低 | 0.55-0.68rem（紧凑场景）|
| 布局 | 保持信息密度，**不放大** |
| 数据表格 | 高对比清晰，**不玻璃化/不模糊** |

---

## 9. 交互规范

| 状态 | 规范 |
|------|------|
| 按钮 hover | 渐变提亮 + 微上浮 + 阴影增强 |
| 选中项 | 亮蓝背景 `rgba(79,195,247,0.15)` + 亮蓝文字 |
| 危险操作 | `error.main` 红 + 确认弹窗 |
| 右键菜单 | DataGrip 风格：面板 130-220px，图标 11px minWidth 18，危险色 `#F87171`，hover 青 `rgba(6,182,212,0.1)` |
| 滚动条 | 自定义 10px 宽，拇指半透明，hover 亮蓝 |

---

## 10. 实现位置

| 内容 | 位置 |
|------|------|
| 主题唯一实现 | `src/theme.ts`（palette/shape/shadows/gradients/transitions/components）|
| 全局缩放 | `src/App.tsx` 根 Box `--dc-scale` + `htmlFontSizePx` |
| 设计预览 | `docs/ui-style-preview.html`（4 风格对比）|

---

## 11. 🕐 演进记录

- **v1.5 及以前**：DBeaver 炭黑扁平（`#2B2B2B`/`#3C3F41`/`#BBBBBB`/`#42A5F5`）
- **v1.6（2026-08-12）**：升级为**深空科技**（`#0F1418`/`#141A1F`/`#0084C8`/`#D4A72C`）+ 圆角/阴影/渐变/过渡精修
- ⚠️ 引用旧版色值（#2B2B2B 等）的文档/代码，均以本文档为准
