# src/components 目录重构与迁移方案（最终执行版）

本方案用于将当前过于分散且命名不一致的前端 UI 组件进行系统性重构，目标是：
- 建立“共享 UI 库（ui/）+ 业务功能模块（features/）”的稳定结构
- 统一命名规则，便于检索、复用与增量演进
- 分阶段稳妥迁移，保证任意阶段都可编译运行

不在本次范围：API/数据流重构、视觉设计改造、依赖升级。

---

## 1. 目标目录结构（提案）

- src/components/
  - ui/（共享可复用的通用组件与行为）
    - modals/
    - popovers/
    - menus/
    - inputs/
    - date-picker/
    - renderers/
    - feedback/
    - behavior/
    - widgets/
    - suggest/
    - tree/
  - features/（按业务域分组）
    - calendar/（algorithm、rendering、views）
    - gantt/
    - kanban/
    - quadrant/
    - habit/
    - onboarding/
    - quick-capture/
    - workflow/
    - settings/
      - tabs/
      - components/
      - core/
    - task/
      - edit/
      - view/
      - filter/
    - timeline-sidebar/
    - read-mode/
    - table/
    - on-completion/

说明：每个二级/三级目录都添加 index.ts 作为 barrel 出口（统一导出）。

---

## 2. 命名规则

- 目录：kebab-case（如 on-completion、habit-card）
- 文件：导出“类/组件”的文件使用 PascalCase（ConfirmModal.ts、TaskList.ts）
- 后缀统一：Modal/Popover/Dialog/View/Component/Renderer/Manager/Service/Widget/Suggest/Tab
- 设置页签统一为 XxxxSettingsTab.ts（注意复数 Settings）
- 文件名与主要导出保持一致

---

## 3. 分阶段迁移计划

建议每阶段单独提交一次，采用 git mv 保留历史；阶段结束进行编译与关键 UI 冒烟检查。

### Phase 0：准备
- 决定目录命名统一为 kebab-case
- （可选）是否引入路径别名，如：
  - @ui/* -> src/components/ui/*
  - @features/* -> src/components/features/*

### Phase 1：抽取共享 UI（ui/）
- 新建：src/components/ui/{modals,popovers,menus,inputs,date-picker,renderers,feedback,behavior,widgets,suggest,tree}
- 移动与重命名（示例）：
  - AutoComplete.ts → ui/inputs/AutoComplete.ts
  - ConfirmModal.ts → ui/modals/ConfirmModal.ts
  - IframeModal.ts → ui/modals/IframeModal.ts
  - IconMenu.ts → ui/menus/IconMenu.ts
  - MarkdownRenderer.ts → ui/renderers/MarkdownRenderer.ts
  - StatusComponent.ts → ui/feedback/StatusIndicator.ts（建议改名更贴近语义）
  - DragManager.ts → ui/behavior/DragManager.ts
  - ViewComponentManager.ts → ui/behavior/ViewComponentManager.ts
  - date-picker/ → ui/date-picker/
  - common/TreeComponent.ts → ui/tree/TreeComponent.ts
  - common/TreeItemRenderer.ts → ui/tree/TreeItemRenderer.ts
  - suggest/ → ui/suggest/
- 为 ui/ 及其子目录添加 index.ts 出口
- 过渡策略：
  - 方案 A：一次性修正所有 import 到新路径
  - 方案 B：原位置保留同名文件，仅 re-export 新路径（逐步替换后再删除）

### Phase 2：合并业务功能模块（features/）
- 新建：src/components/features/
- 迁移（示例）：
  - calendar/ → features/calendar/（algorithm.ts、rendering/、views/ 原样保留）
  - gantt/ → features/gantt/
  - kanban/ → features/kanban/
  - quadrant/ → features/quadrant/
  - onboarding/ → features/onboarding/
  - timeline-sidebar/ → features/timeline-sidebar/
  - readModeProgressbarWidget.ts → features/read-mode/ReadModeProgressBarWidget.ts（规范大小写与单词分割）
  - readModeTextMark.ts → features/read-mode/ReadModeTextMark.ts
  - habit/ → features/habit/
    - habit/habitcard/ → features/habit/components/habit-card/
    - HabitEditDialog.ts → features/habit/components/HabitEditDialog.ts
    - RewardModal.ts → （二选一）
      - A. features/habit/modals/RewardModal.ts
      - B. features/reward/modals/RewardModal.ts（与 RewardSettingsTab 形成一组）
  - quick-capture/
    - MinimalQuickCaptureModal.ts → features/quick-capture/modals/MinimalQuickCaptureModal.ts
    - QuickCaptureModal.ts → features/quick-capture/modals/QuickCaptureModal.ts
    - MinimalQuickCaptureSuggest.ts → features/quick-capture/suggest/MinimalQuickCaptureSuggest.ts（或 MinimalQuickCaptureSuggester.ts）
  - workflow/
    - QuickWorkflowModal.ts → features/workflow/modals/QuickWorkflowModal.ts
    - StageEditModal.ts → features/workflow/modals/StageEditModal.ts
    - WorkflowDefinitionModal.ts → features/workflow/modals/WorkflowDefinitionModal.ts
    - WorkflowProgressIndicator.ts → （二选一）
      - A. features/workflow/widgets/WorkflowProgressIndicator.ts
      - B. ui/widgets/WorkflowProgressIndicator.ts（视作通用）
  - task/
    - task-edit/ → features/task/edit/
    - task-view/ → features/task/view/
    - task-filter/ → features/task/filter/
    - inview-filter/ → features/task/filter/in-view/（或保留为 features/in-view-filter/）
  - table/ → features/table/
  - onCompletion/ → features/on-completion/
- 为 features/* 添加 index.ts 出口

### Phase 3：标准化设置（settings/）
- settings/ → features/settings/
  - tabs/：将所有 *SettingsTab.ts 移至此处并统一命名（保持 *SettingsTab）
    - TaskTimerSettingTab.ts → TaskTimerSettingsTab.ts（修正为复数 Settings）
  - components/：
    - FileSourceSettings.ts → components/FileSourceSettingsSection.ts（增加 Section 后缀更贴合）
    - SettingsSearchComponent.ts → components/SettingsSearchComponent.ts
  - core/：
    - SettingsIndexer.ts → core/SettingsIndexer.ts
  - 更新 features/settings/index.ts，统一导出 tabs/components/core

### Phase 4：统一导入与过渡清理
- 在 ui/ 与各 features/* 目录添加 index.ts（barrel 模式）
- 采用路径别名或相对路径统一 import：
  - import { ConfirmModal } from '@ui/modals'
  - import { TaskList } from '@features/task/view'
- 若采用过渡 re-export：
  - 原路径文件仅保留：export * from '新路径'
  - 扫描替换存量 import 后，最终删除过渡文件

### Phase 5：收尾
- 删除所有过渡 re-export 文件
- 搜索并清理旧路径残留引用
- 全量构建 + 核心 UI 冒烟

---

## 4. 详细映射清单（代表性）

- 顶层散落组件 → ui/ 或特性模块
  - AutoComplete.ts → ui/inputs/AutoComplete.ts
  - ConfirmModal.ts → ui/modals/ConfirmModal.ts
  - IframeModal.ts → ui/modals/IframeModal.ts
  - IconMenu.ts → ui/menus/IconMenu.ts
  - MarkdownRenderer.ts → ui/renderers/MarkdownRenderer.ts
  - StatusComponent.ts → ui/feedback/StatusIndicator.ts
  - DragManager.ts → ui/behavior/DragManager.ts
  - ViewComponentManager.ts → ui/behavior/ViewComponentManager.ts
  - ViewConfigModal.ts → features/task/view/modals/ViewConfigModal.ts
  - QuickWorkflowModal.ts → features/workflow/modals/QuickWorkflowModal.ts
  - WorkflowProgressIndicator.ts → features/workflow/widgets/WorkflowProgressIndicator.ts（或 ui/widgets/…）
  - readModeProgressbarWidget.ts → features/read-mode/ReadModeProgressBarWidget.ts
  - readModeTextMark.ts → features/read-mode/ReadModeTextMark.ts

- 目录整体迁移
  - calendar → features/calendar（algorithm.ts、rendering/、views/）
  - date-picker → ui/date-picker
  - suggest → ui/suggest
  - common/Tree* → ui/tree
  - gantt/、kanban/、quadrant/、onboarding/ → 对应 features/*
  - task-edit/、task-filter/、task-view/ → features/task 下分 edit/filter/view
  - inview-filter/ → features/task/filter/in-view（或 features/in-view-filter）
  - onboarding/、timeline-sidebar/、table/、onCompletion/ → 对应 features/*
  - habit/ + habitcard/ + HabitEditDialog.ts + RewardModal.ts → 归入 features/habit（或 RewardModal 放 features/reward）

- settings 专项
  - 全部 *SettingsTab.ts → features/settings/tabs/
  - FileSourceSettings.ts → features/settings/components/FileSourceSettingsSection.ts
  - SettingsIndexer.ts → features/settings/core/SettingsIndexer.ts
  - SettingsSearchComponent.ts → features/settings/components/SettingsSearchComponent.ts

---

## 5. 过渡 re-export 示例（可选策略 B）

- 原文件 src/components/ConfirmModal.ts（仅保留）：

```ts
export * from './ui/modals/ConfirmModal'
```

- 原目录 src/components/suggest/index.ts（仅保留）：

```ts
export * from '../ui/suggest'
```

后续逐步把业务代码的 import 改为新路径，再删除这些过渡文件。

---

## 6. （可选）路径别名建议

- 若采用 tsconfig 路径：

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@ui/*": ["src/components/ui/*"],
      "@features/*": ["src/components/features/*"]
    }
  }
}
```

- import 示例：

```ts
import { ConfirmModal } from '@ui/modals'
import { TaskList } from '@features/task/view'
```

---

## 7. 验证清单

- 每阶段完成后：
  - 构建通过，无 TS 路径错误
  - 搜索旧路径是否仍有引用
  - 核心 UI（如任务视图、设置页、日历）打开不报错
- 最终阶段：清除过渡 re-export，所有 import 指向新结构

---

## 8. 未决项（待确认）

- inview-filter：
  - A. 收敛到 features/task/filter/in-view/
  - B. 独立 features/in-view-filter/
- RewardModal：
  - A. 放 features/habit/
  - B. 放 features/reward/（与 RewardSettingsTab 配对）
- WorkflowProgressIndicator：
  - A. 放 features/workflow/widgets/
  - B. 放 ui/widgets/（若确认为通用）
- 是否启用 @ui / @features 路径别名

---

## 9. 执行建议

- 使用 git mv，按阶段提交，commit message 清晰指明范围
- 优先迁移“共享 UI”，减少后续重复
- 大范围修改 import 前，优先采用过渡 re-export，降低一次性影响
- 阶段结束进行构建与冒烟，确保安全可回滚



---

## 10. 详细执行步骤（可直接复制运行）

以下步骤假设你在仓库根目录执行，使用 git mv 确保历史保留。若路径别名未启用，请保持相对路径；若启用，请在 Phase 4 统一替换 import。

### Phase 1：抽取共享 UI（ui/）

1) 创建目录

```bash
mkdir -p src/components/ui/{modals,popovers,menus,inputs,date-picker,renderers,feedback,behavior,widgets,suggest,tree}
```

2) 移动文件（命令清单）

```bash
# 顶层散落文件 → ui

git mv src/components/AutoComplete.ts src/components/ui/inputs/AutoComplete.ts

git mv src/components/ConfirmModal.ts src/components/ui/modals/ConfirmModal.ts

git mv src/components/IframeModal.ts src/components/ui/modals/IframeModal.ts

git mv src/components/IconMenu.ts src/components/ui/menus/IconMenu.ts

git mv src/components/MarkdownRenderer.ts src/components/ui/renderers/MarkdownRenderer.ts

git mv src/components/DragManager.ts src/components/ui/behavior/DragManager.ts

git mv src/components/ViewComponentManager.ts src/components/ui/behavior/ViewComponentManager.ts

# 状态指示重命名（建议）
# 如需保留原名，可跳过，后续统一改名
# 方案 A：直接重命名

git mv src/components/StatusComponent.ts src/components/ui/feedback/StatusIndicator.ts

# Date Picker 整体

git mv src/components/date-picker src/components/ui/date-picker

# Tree 相关
mkdir -p src/components/ui/tree

git mv src/components/common/TreeComponent.ts src/components/ui/tree/TreeComponent.ts

git mv src/components/common/TreeItemRenderer.ts src/components/ui/tree/TreeItemRenderer.ts

# Suggest 整体

git mv src/components/suggest src/components/ui/suggest
```

3) （可选）在旧位置添加过渡 re-export（若暂不批量改 import）

```bash
# 示例：创建 src/components/ConfirmModal.ts 并仅导出新路径（如果前一步已移动，可新建同名文件）
# echo "export * from './ui/modals/ConfirmModal'" > src/components/ConfirmModal.ts
# 其他类似文件按需添加
```

4) 添加 barrel 出口（index.ts）

```bash
# 示例：为 ui/ 及子目录创建 index.ts（根据实际导出补充）
# echo "export * from './modals'" > src/components/ui/index.ts
# echo "export * from './ConfirmModal'" > src/components/ui/modals/index.ts
```

提交：

```bash
git add -A
git commit -m "refactor(components): extract shared UI into src/components/ui/* (phase 1)"
```

---

### Phase 2：合并业务功能模块（features/）

1) 创建目录

```bash
mkdir -p src/components/features/{calendar,gantt,kanban,quadrant,habit,onboarding,quick-capture,workflow,settings,task/{edit,view,filter},timeline-sidebar,read-mode,table,on-completion}
```

2) 迁移与重命名（命令清单）

```bash
# Calendar

git mv src/components/calendar src/components/features/calendar

# Gantt / Kanban / Quadrant / Onboarding

git mv src/components/gantt src/components/features/gantt

git mv src/components/kanban src/components/features/kanban

git mv src/components/quadrant src/components/features/quadrant

git mv src/components/onboarding src/components/features/onboarding

# Timeline Sidebar

git mv src/components/timeline-sidebar src/components/features/timeline-sidebar

# Read Mode（并统一大小写）
mkdir -p src/components/features/read-mode

git mv src/components/readModeProgressbarWidget.ts src/components/features/read-mode/ReadModeProgressBarWidget.ts

git mv src/components/readModeTextMark.ts src/components/features/read-mode/ReadModeTextMark.ts

# Habit

git mv src/components/habit src/components/features/habit
mkdir -p src/components/features/habit/components/habit-card

git mv src/components/habit/habitcard src/components/features/habit/components/habit-card

git mv src/components/HabitEditDialog.ts src/components/features/habit/components/HabitEditDialog.ts

# Reward（依你选择，若归入 habit 则移动到 habit 下）
# git mv src/components/RewardModal.ts src/components/features/habit/modals/RewardModal.ts
# 或：
# mkdir -p src/components/features/reward/modals
# git mv src/components/RewardModal.ts src/components/features/reward/modals/RewardModal.ts

# Quick Capture
mkdir -p src/components/features/quick-capture/{modals,suggest}

git mv src/components/MinimalQuickCaptureModal.ts src/components/features/quick-capture/modals/MinimalQuickCaptureModal.ts

git mv src/components/QuickCaptureModal.ts src/components/features/quick-capture/modals/QuickCaptureModal.ts

git mv src/components/MinimalQuickCaptureSuggest.ts src/components/features/quick-capture/suggest/MinimalQuickCaptureSuggest.ts

# Workflow
mkdir -p src/components/features/workflow/{modals,widgets}

git mv src/components/QuickWorkflowModal.ts src/components/features/workflow/modals/QuickWorkflowModal.ts

git mv src/components/StageEditModal.ts src/components/features/workflow/modals/StageEditModal.ts

git mv src/components/WorkflowDefinitionModal.ts src/components/features/workflow/modals/WorkflowDefinitionModal.ts

git mv src/components/WorkflowProgressIndicator.ts src/components/features/workflow/widgets/WorkflowProgressIndicator.ts

# Task（edit/view/filter）
mkdir -p src/components/features/task/{edit,view,filter}

git mv src/components/task-edit src/components/features/task/edit

git mv src/components/task-view src/components/features/task/view

git mv src/components/task-filter src/components/features/task/filter

# In-view Filter（两种放置方式其一）
# 方案 A：
mkdir -p src/components/features/task/filter/in-view

git mv src/components/inview-filter src/components/features/task/filter/in-view
# 方案 B：
# mkdir -p src/components/features/in-view-filter
# git mv src/components/inview-filter src/components/features/in-view-filter

# Table

git mv src/components/table src/components/features/table

# On Completion（目录名统一为 kebab-case）

git mv src/components/onCompletion src/components/features/on-completion
```

3) 为各 features/* 添加 index.ts（按需）并提交：

```bash
git add -A
git commit -m "refactor(components): consolidate feature modules under src/components/features/* (phase 2)"
```

---

### Phase 3：标准化设置（settings/）

```bash
# 将 settings 迁移到 features/settings
mkdir -p src/components/features/settings/{tabs,components,core}

git mv src/components/settings/AboutSettingsTab.ts src/components/features/settings/tabs/AboutSettingsTab.ts

git mv src/components/settings/BasesSettingsTab.ts src/components/features/settings/tabs/BasesSettingsTab.ts

git mv src/components/settings/BetaTestSettingsTab.ts src/components/features/settings/tabs/BetaTestSettingsTab.ts

git mv src/components/settings/DatePrioritySettingsTab.ts src/components/features/settings/tabs/DatePrioritySettingsTab.ts

git mv src/components/settings/FileFilterSettingsTab.ts src/components/features/settings/tabs/FileFilterSettingsTab.ts

git mv src/components/settings/HabitSettingsTab.ts src/components/features/settings/tabs/HabitSettingsTab.ts

git mv src/components/settings/IcsSettingsTab.ts src/components/features/settings/tabs/IcsSettingsTab.ts

git mv src/components/settings/IndexSettingsTab.ts src/components/features/settings/tabs/IndexSettingsTab.ts

git mv src/components/settings/McpIntegrationSettingsTab.ts src/components/features/settings/tabs/McpIntegrationSettingsTab.ts

git mv src/components/settings/ProgressSettingsTab.ts src/components/features/settings/tabs/ProgressSettingsTab.ts

git mv src/components/settings/ProjectSettingsTab.ts src/components/features/settings/tabs/ProjectSettingsTab.ts

git mv src/components/settings/QuickCaptureSettingsTab.ts src/components/features/settings/tabs/QuickCaptureSettingsTab.ts

git mv src/components/settings/RewardSettingsTab.ts src/components/features/settings/tabs/RewardSettingsTab.ts

git mv src/components/settings/TaskFilterSettingsTab.ts src/components/features/settings/tabs/TaskFilterSettingsTab.ts

git mv src/components/settings/TaskHandlerSettingsTab.ts src/components/features/settings/tabs/TaskHandlerSettingsTab.ts

git mv src/components/settings/TaskStatusSettingsTab.ts src/components/features/settings/tabs/TaskStatusSettingsTab.ts

git mv src/components/settings/TimeParsingSettingsTab.ts src/components/features/settings/tabs/TimeParsingSettingsTab.ts

git mv src/components/settings/TimelineSidebarSettingsTab.ts src/components/features/settings/tabs/TimelineSidebarSettingsTab.ts

git mv src/components/settings/ViewSettingsTab.ts src/components/features/settings/tabs/ViewSettingsTab.ts

git mv src/components/settings/WorkflowSettingsTab.ts src/components/features/settings/tabs/WorkflowSettingsTab.ts

# 修正单复数：TaskTimerSettingTab.ts -> TaskTimerSettingsTab.ts

git mv src/components/settings/TaskTimerSettingTab.ts src/components/features/settings/tabs/TaskTimerSettingsTab.ts

# 其他设置相关组件

git mv src/components/settings/FileSourceSettings.ts src/components/features/settings/components/FileSourceSettingsSection.ts

git mv src/components/settings/SettingsIndexer.ts src/components/features/settings/core/SettingsIndexer.ts

git mv src/components/settings/SettingsSearchComponent.ts src/components/features/settings/components/SettingsSearchComponent.ts

# index.ts 移至新位置（如需要保留，可改为 re-export）
# git mv src/components/settings/index.ts src/components/features/settings/index.ts
```

提交：

```bash
git add -A
git commit -m "refactor(settings): standardize settings under features/settings with tabs/components/core (phase 3)"
```

---

### Phase 4：barrels、import 与过渡清理

1) 添加/完善 index.ts（示例）

```bash
# ui/index.ts → 按子目录导出
# features/*/index.ts → 导出每个模块公共 API
```

2) （可选）启用路径别名并批量替换 import（示例）

```bash
# tsconfig.json 中添加 paths（见上文第 6 节）
# 然后批量替换 import：
# from 'src/components/ui/...' → from '@ui/...'
# from 'src/components/features/...' → from '@features/...'
```

3) 若采用过渡 re-export，逐步替换后删除旧文件

提交：

```bash
git add -A
git commit -m "refactor(components): add barrels and update imports; remove transitional re-exports (phase 4)"
```

---

### Phase 5：收尾

```bash
# 搜索旧路径残留
rg -n "src/components/(?!ui|features)/" src | cat

# 最终清理与提交
git add -A
git commit -m "refactor(components): finalize directory migration and clean up (phase 5)"
```

> 注：若未安装 ripgrep(rg)，可使用 grep -R -n 进行搜索。
