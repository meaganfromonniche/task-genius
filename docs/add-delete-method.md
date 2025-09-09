## 目标

- 在 Task 视图（src/pages/TaskView.ts）中，为每个任务的右键菜单新增“删除任务”按钮。
- 当目标任务存在子任务时，弹出二次确认，允许选择“仅删除该任务”或“删除该任务及所有子任务”。
- 完成后，数据流（Dataflow）中缓存/索引即时更新；WriteAPI 支持级联删除并发出明确的事件，Canvas 任务同样支持。

## 涉及范围

- UI：TaskView 右键菜单、用户确认弹窗
- 应用层：调用 WriteAPI 的删除接口（新增 deleteChildren 支持）
- Dataflow/事件：明确发出 TASK_DELETED（含批量删除信息），监听方执行增量删除更新
- Markdown/Canvas 文件写入：单行删除与“子树”删除；Canvas 文本节点的删除逻辑
- i18n：新增菜单与确认文案

## 交互与用户体验

- 右键菜单新增“删除任务”项：
  - 无子任务：点击后直接删除，删除成功后在 UI 中移除，toast/notice 简短提示
  - 有子任务：点击后弹确认对话框，内容包含：
    - 选项 A：仅删除该任务（保留子任务，子任务提升为同级或根据设计保留缩进，见“边界与策略”）
    - 选项 B：删除该任务及其所有子任务
- 删除完成后，列表立即更新，无需刷新；如失败显示错误提示

建议文案（以 t(key) 引用）：
- t("Delete Task")，t("Delete")，t("Delete task only")，t("Delete task and all subtasks")，t("This task has N subtasks. How would you like to proceed?")

## 数据流与事件

- WriteAPI 删除成功后显式发出：
  - Events.TASK_DELETED，payload 建议：
    - taskId: string
    - filePath: string
    - deletedTaskIds: string[]（若级联删除，包含所有被删节点；仅删除自己则数组长度为 1）
    - mode: "single" | "subtree"
  - 继续保留现有 WRITE_OPERATION_START/COMPLETE 事件（兼容已有 Orchestrator）
- Dataflow 监听 TASK_DELETED，做增量更新：
  - 从任务缓存/索引移除对应 taskId 与其 descendants
  - 调整同文件中被删行下方任务的行号（如你的索引维护行号）
  - 发出 TASK_CACHE_UPDATED 或对应局部更新事件（当前架构已有 TASK_CACHE_UPDATED）

说明：现有 Events.ts 已定义 TASK_DELETED 常量，但 WriteAPI.deleteTask 尚未发出；此次补齐并优先级采用 TASK_DELETED 进行 UI 直达更新，减少“全量重扫”开销。

## WriteAPI 方案（Markdown + Canvas）

在 src/dataflow/api/WriteAPI.ts：

1) DeleteTaskArgs 增加 deleteChildren?: boolean
- interface DeleteTaskArgs { taskId: string; deleteChildren?: boolean }

2) deleteTask(args) 行为扩展
- 读取目标任务（getTaskById）
- 分支：
  - Canvas 任务：调用 deleteCanvasTask，并新增支持级联删除的实现（见下）
  - Markdown 任务：
    - 无级联（默认）：按现有逻辑，删除该行
    - 级联（deleteChildren=true）：
      - 方式 A（优先）：依赖任务索引拿到 descendants 列表，按行号聚合并自底向上批量删除
      - 方式 B（回退）：基于 Markdown 缩进扫描“子树”范围（见算法）
- 发出 WRITE_OPERATION_START → vault.modify → WRITE_OPERATION_COMPLETE
- 新增：emit(Events.TASK_DELETED, { taskId, filePath, deletedTaskIds, mode })

3) CanvasTaskUpdater（src/parsers/canvas-task-updater.ts）
- 现有 deleteCanvasTask 仅删除单条。扩展：
  - 解析文本节点后，按“子树”算法在纯文本中删除对应行和被嵌套的子任务行
  - 返回 updatedContent
- WriteAPI.deleteTask 在 Canvas 分支拿到 descendants 时同样构造 deletedTaskIds 并 emit TASK_DELETED

### Markdown “子树”删除算法（回退策略）

- 读取文件并 split 为行数组
- 定位父任务行 parentLine 与其前导空白长度 parentIndent（空格数/制表符长度）
- 从 parentLine + 1 开始向下扫描，直到：
  - 遇到同级或上级的任务项（识别条件：以空白+[-*+] [ ] 或 [x] 开头，且当前行的前导空白长度 <= parentIndent），停止
  - 中间所有“子任务行”记录进删除列表（建议仅删除带复选框的“任务行”，不删除纯文本说明行，以避免误删注释；如需同时删除说明行，需与产品确认）
- 删除集合 = {parentLine} ∪ {子任务行集合}
- 自底向上 splice 删除，防止行号位移

注意：你们当前已有 insertSubtask 等方法，说明对缩进/父子关系已有约定，上述算法应与解析器保持一致。首选用索引的 descendants 做删除集合，回退才用缩进扫描。

## Task 索引/缓存配合

- 如果当前索引已维护 parent/children 关系，建议新增一个工具：
  - getDescendants(taskId): string[]，返回所有后代 ID（含子、孙…）
- Dataflow 监听 TASK_DELETED 后：
  - 从 Map/Index 移除 taskId 与这些 descendants
  - 如果仅删除父节点且保留子节点，需决定“提升子节点为同级”还是“保留缩进但无父”（推荐与产品/设计确定，见“边界与策略”）
  - 对于同文件更靠下的任务，若你们缓存了 line，执行行号偏移修正（根据删除的行数）

## UI 改动（src/pages/TaskView.ts）

在 handleTaskContextMenu 内新增一项：
- “删除任务”菜单项
- onClick:
  - 查索引判断是否存在子任务（优先索引；没有则可只弹一次确认“是否删除”，简单版）
  - 无子任务：直接调用 this.plugin.writeApi.deleteTask({ taskId: task.id })
  - 有子任务：弹窗：
    - 仅删除该任务：deleteChildren=false
    - 删除任务及所有子任务：deleteChildren=true
  - 删除成功后：可显式从本地列表移除项（或依赖 TASK_DELETED 事件驱动刷新）
  - 失败：显示 Notice 提示

确认弹窗可以使用 ConfirmModal.ts

## Canvas 支持

- CanvasTaskUpdater.deleteTaskFromTextNode 目前只处理单行任务删除，需扩展为支持“子树”：
  - 与 Markdown 回退算法类似，在 Canvas 文本节点的 Markdown 中计算子树范围
  - 修改 Canvas JSON 后写回
- WriteAPI.deleteTask 对 Canvas 分支传递 deleteChildren 参数，并组装 deletedTaskIds（索引可提供 descendants；若无，则按文本子树扫描推导）

## i18n

新增 keys（示例）：
- "Delete Task", "Delete", "Delete task only", "Delete task and all subtasks", "This task has {n} subtasks. How would you like to proceed?", "Deleted", "Failed to delete task"

## 边界与策略待确认

- 仅删除父节点时子节点的处理策略：
  - 选项 1：子任务整体提升为父节点的同级（需要在 WriteAPI 中调整这些行的缩进，较复杂）
  - 选项 2：保留原缩进但无父（可能导致“悬空子任务”）
  - 选项 3：UI 层不提供“仅删除父节点”，统一为“删除父及所有子节点”以避免歧义（最简单）
- 是否删除带说明的非任务行（不带复选框的列表项/文本）：
  - 默认只删除“任务行”（有复选框）
  - 若确需一并删除说明行，需明确说明行的识别规则（例如直到下一个同级任务或空行）
- FileSource 任务（metadata.source === "file-source"）的删除语义：
  - 若支持删除，是否需要发出 FILE_TASK_REMOVED 之类事件（项目中已有 FILE_TASK_REMOVED 常量）
- 撤销/回滚：依赖 Obsidian 本身文件级撤销还是需要插件内提供 Undo？（建议先依赖 Obsidian）

## 验收标准

- 右键菜单出现“删除任务”，符合 i18n
- 无子任务：点击后文件内容更新、缓存更新、UI 移除该任务
- 有子任务：
  - 仅删除父：父行被删、子任务处理符合策略（见上）
  - 删除父及所有子：对应行全部删除，deletedTaskIds 包含所有被删任务
- Markdown/Canvas 两种来源都支持
- 事件序列正确：
  - WRITE_OPERATION_START → 文件修改 → WRITE_OPERATION_COMPLETE
  - 以及 TASK_DELETED（包含 deletedTaskIds）
- 删除后不出现“幽灵任务”（索引和 UI 无残留）
- 无控制台报错，异常可见错误提示

## 分工与实施清单（按文件）

1) src/pages/TaskView.ts
- 在 handleTaskContextMenu 添加“删除任务”菜单项
- 新增 confirmAndDeleteTask(task)：
  - 读取 descendants 数（索引或简单判断）
  - 显示确认对话框（存在子任务时）
  - 调用 this.plugin.writeApi.deleteTask({ taskId: task.id, deleteChildren })
  - 成功后依赖 TASK_DELETED 刷新或局部移除

2) src/dataflow/api/WriteAPI.ts
- 扩展 DeleteTaskArgs：deleteChildren?: boolean
- deleteTask：
  - 读取任务，分 Canvas/Markdown
  - Markdown：
    - deleteChildren=true 时按索引 descendants 或缩进扫描删除集合；自底向上删除
  - Canvas：调用扩展后的 deleteCanvasTask，支持子树
  - 发出 WRITE_OPERATION_START/COMPLETE 和 TASK_DELETED（带 deletedTaskIds）
- 如需，针对 file-source 任务发 FILE_TASK_REMOVED

3) src/parsers/canvas-task-updater.ts
- 扩展 deleteCanvasTask 支持 deleteChildren 或新增 deleteCanvasTaskSubtree
- 在文本节点里按缩进/层级识别子树并删除

4) Dataflow 监听与缓存
- 监听 TASK_DELETED，移除缓存中任务及 descendants，修正行号偏移，最后 emit TASK_CACHE_UPDATED
- 若当前已有 Orchestrator 依赖 WRITE_OPERATION_COMPLETE 触发全量更新，可在过渡期两者都保留

5) i18n
- 增加相关键（中英）