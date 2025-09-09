import {
	ItemView,
	WorkspaceLeaf,
	TFile,
	Plugin,
	setIcon,
	ExtraButtonComponent,
	ButtonComponent,
	Menu,
	Scope,
	Notice,
	Platform,
	debounce,
	// FrontmatterCache,
} from "obsidian";
import { Task } from "../types/task";
import { SidebarComponent } from "../components/features/task/view/sidebar";
import { ContentComponent } from "../components/features/task/view/content";
import { ForecastComponent } from "../components/features/task/view/forecast";
import { TagsComponent } from "../components/features/task/view/tags";
import { ProjectsComponent } from "../components/features/task/view/projects";
import { ReviewComponent } from "../components/features/task/view/review";
import {
	TaskDetailsComponent,
	createTaskCheckbox,
} from "../components/features/task/view/details";
import "../styles/view.css";
import TaskProgressBarPlugin from "../index";
import { QuickCaptureModal } from "../components/features/quick-capture/modals/QuickCaptureModal";
import { t } from "../translations/helper";
import {
	getViewSettingOrDefault,
	ViewMode,
	DEFAULT_SETTINGS,
	TwoColumnSpecificConfig,
} from "../common/setting-definition";
import { filterTasks } from "../utils/task/task-filter-utils";
import {
	CalendarComponent,
	CalendarEvent,
} from "../components/features/calendar";
import { KanbanComponent } from "../components/features/kanban/kanban";
import { GanttComponent } from "../components/features/gantt/gantt";
import { TaskPropertyTwoColumnView } from "../components/features/task/view/TaskPropertyTwoColumnView";
import { ViewComponentManager } from "../components/ui/behavior/ViewComponentManager";
import { Habit } from "../components/features/habit/habit";
import { ConfirmModal } from "../components/ui/modals/ConfirmModal";
import {
	ViewTaskFilterPopover,
	ViewTaskFilterModal,
} from "../components/features/task/filter";
import {
	Filter,
	FilterGroup,
	RootFilterState,
} from "../components/features/task/filter/ViewTaskFilter";
import { FilterConfigModal } from "../components/features/task/filter/FilterConfigModal";
import { SavedFilterConfig } from "../common/setting-definition";
import { isDataflowEnabled } from "../dataflow/createDataflow";

export const TASK_VIEW_TYPE = "task-genius-view";

export class TaskView extends ItemView {
	// Main container elements
	private rootContainerEl: HTMLElement;

	// Component references
	private sidebarComponent: SidebarComponent;
	private contentComponent: ContentComponent;
	private forecastComponent: ForecastComponent;
	private tagsComponent: TagsComponent;
	private projectsComponent: ProjectsComponent;
	private reviewComponent: ReviewComponent;
	private detailsComponent: TaskDetailsComponent;
	private calendarComponent: CalendarComponent;
	private kanbanComponent: KanbanComponent;
	private ganttComponent: GanttComponent;
	private viewComponentManager: ViewComponentManager; // 新增：统一的视图组件管理器
	// Custom view components by view ID
	private twoColumnViewComponents: Map<string, TaskPropertyTwoColumnView> =
		new Map();
	// UI state management
	private isSidebarCollapsed: boolean = false;
	private isDetailsVisible: boolean = false;
	private sidebarToggleBtn: HTMLElement;
	private detailsToggleBtn: HTMLElement;
	private currentViewId: ViewMode = "inbox";
	private currentSelectedTaskId: string | null = null;
	private currentSelectedTaskDOM: HTMLElement | null = null;
	private lastToggleTimestamp: number = 0;
	private habitComponent: Habit;

	private tabActionButton: HTMLElement;

	// Data management
	tasks: Task[] = [];

	private currentFilterState: RootFilterState | null = null;
	private liveFilterState: RootFilterState | null = null; // 新增：专门跟踪实时过滤器状态

	// 创建防抖的过滤器应用函数
	private debouncedApplyFilter = debounce(() => {
		this.applyCurrentFilter();
	}, 400); // 增加延迟到 400ms 减少频繁更新

	constructor(leaf: WorkspaceLeaf, private plugin: TaskProgressBarPlugin) {
		super(leaf);

		this.tasks = this.plugin.preloadedTasks || [];

		this.scope = new Scope(this.app.scope);

		this.scope?.register(null, "escape", (e) => {
			e.preventDefault();
			e.stopPropagation();
		});
	}

	getViewType(): string {
		return TASK_VIEW_TYPE;
	}

	getDisplayText(): string {
		const currentViewConfig = getViewSettingOrDefault(
			this.plugin,
			this.currentViewId
		);
		return currentViewConfig.name;
	}

	getIcon(): string {
		const currentViewConfig = getViewSettingOrDefault(
			this.plugin,
			this.currentViewId
		);
		return currentViewConfig.icon;
	}

	async onOpen() {
		this.contentEl.toggleClass("task-genius-view", true);
		this.rootContainerEl = this.contentEl.createDiv({
			cls: "task-genius-container",
		});

		// Add debounced view update to prevent rapid successive refreshes
		const debouncedViewUpdate = debounce(async () => {
			// For external/editor updates, force a view refresh to avoid false "unchanged" skips
			await this.loadTasks(false, true); // skip internal triggerViewUpdate
			this.switchView(this.currentViewId, undefined, true); // forceRefresh
		}, 500); // 增加到 500ms 防抖延迟，避免频繁更新导致中间状态显示

		// 1. 首先注册事件监听器，确保不会错过任何更新
		if (
			isDataflowEnabled(this.plugin) &&
			this.plugin.dataflowOrchestrator
		) {
			// Dataflow: 订阅统一事件
			const { on, Events } = await import("../dataflow/events/Events");
			this.registerEvent(
				on(this.app, Events.CACHE_READY, async () => {
					// 冷启动就绪，从快照加载
					await this.loadTasksFast(true);
				})
			);
			this.registerEvent(
				on(this.app, Events.TASK_CACHE_UPDATED, debouncedViewUpdate)
			);
		} else {
			// Legacy: 兼容旧事件
			this.registerEvent(
				this.app.workspace.on(
					"task-genius:task-cache-updated",
					debouncedViewUpdate
				)
			);
		}

		// 监听过滤器变更事件
		this.registerEvent(
			this.app.workspace.on(
				"task-genius:filter-changed",
				(filterState: RootFilterState, leafId?: string) => {
					// 只有来自实时过滤器组件的变更才更新liveFilterState
					// 排除基础过滤器（ViewConfigModal）和全局过滤器的变更
					if (
						leafId &&
						!leafId.startsWith("view-config-") &&
						leafId !== "global-filter"
					) {
						// 这是来自实时过滤器组件的变更
						this.liveFilterState = filterState;
						this.currentFilterState = filterState;
						console.log("更新实时过滤器状态");
					} else if (!leafId) {
						// 没有leafId的情况，也视为实时过滤器变更
						this.liveFilterState = filterState;
						this.currentFilterState = filterState;
						console.log("更新实时过滤器状态（无leafId）");
					}

					// 使用防抖函数应用过滤器，避免频繁更新
					this.debouncedApplyFilter();
				}
			)
		);

		// 监听视图配置变更事件（仅刷新侧边栏与当前视图可见性）
		this.registerEvent(
			this.app.workspace.on(
				"task-genius:view-config-changed",
				(payload: { reason: string; viewId?: string }) => {
					try {
						// 先重绘侧边栏项目
						if (
							this.sidebarComponent &&
							typeof this.sidebarComponent.renderSidebarItems ===
								"function"
						) {
							this.sidebarComponent.renderSidebarItems();
						}
					} catch (e) {
						console.warn(
							"Failed to render sidebar items on view-config-changed:",
							e
						);
					}

					// If the edited view is the current one (e.g., type/layout changed), force refresh the main content
					if (
						payload?.viewId &&
						payload.viewId === this.currentViewId
					) {
						this.switchView(this.currentViewId, undefined, true);
					}

					// 若当前视图被设为不可见，则切换到第一个可见视图（不强制刷新内容）
					const currentCfg =
						this.plugin.settings.viewConfiguration.find(
							(v) => v.id === this.currentViewId
						);
					if (!currentCfg?.visible) {
						const firstVisible =
							this.plugin.settings.viewConfiguration.find(
								(v) => v.visible
							)?.id as ViewMode | undefined;
						if (
							firstVisible &&
							firstVisible !== this.currentViewId
						) {
							this.currentViewId = firstVisible;
							this.sidebarComponent?.setViewMode(
								this.currentViewId
							);
							// Ensure main content switches to the new visible view
							this.switchView(
								this.currentViewId,
								undefined,
								true
							);
						}
					}
				}
			)
		);

		// 2. 加载缓存的实时过滤状态
		const savedFilterState = this.app.loadLocalStorage(
			"task-genius-view-filter"
		) as RootFilterState;
		console.log("savedFilterState", savedFilterState);

		if (
			savedFilterState &&
			typeof savedFilterState.rootCondition === "string" &&
			Array.isArray(savedFilterState.filterGroups)
		) {
			console.log("Saved filter state", savedFilterState);
			this.liveFilterState = savedFilterState;
			this.currentFilterState = savedFilterState;
		} else {
			console.log("No saved filter state or invalid state");
			this.liveFilterState = null;
			this.currentFilterState = null;
		}

		console.log("currentFilterState", this.currentFilterState);

		// 3. 初始化组件（但先不传入数据）
		this.initializeComponents();

		// 4. 获取初始视图ID
		const savedViewId = this.app.loadLocalStorage(
			"task-genius:view-mode"
		) as ViewMode;
		const initialViewId = this.plugin.settings.viewConfiguration.find(
			(v) => v.id === savedViewId && v.visible
		)
			? savedViewId
			: this.plugin.settings.viewConfiguration.find((v) => v.visible)
					?.id || "inbox";

		this.currentViewId = initialViewId;
		this.sidebarComponent.setViewMode(this.currentViewId);

		// 5. 快速加载缓存数据以立即显示 UI
		await this.loadTasksFast(false); // Don't skip view update - we need the initial render

		// 6. Only switch view if we have tasks to display
		if (this.tasks.length > 0) {
			this.switchView(this.currentViewId);
		} else {
			// If no tasks loaded yet, wait for background sync before rendering
			console.log(
				"No cached tasks found, waiting for background sync..."
			);
			await this.loadTasksWithSyncInBackground();
			this.switchView(this.currentViewId);
		}

		console.log("currentFilterState", this.currentFilterState);
		// 7. 在组件初始化完成后应用筛选器状态
		if (this.currentFilterState) {
			console.log("应用保存的筛选器状态");
			this.applyCurrentFilter();
		}

		this.toggleDetailsVisibility(false);

		this.createActionButtons();

		(this.leaf.tabHeaderStatusContainerEl as HTMLElement).empty();

		(this.leaf.tabHeaderEl as HTMLElement).toggleClass(
			"task-genius-tab-header",
			true
		);

		this.tabActionButton = (
			this.leaf.tabHeaderStatusContainerEl as HTMLElement
		).createEl(
			"span",
			{
				cls: "task-genius-action-btn",
			},
			(el: HTMLElement) => {
				new ExtraButtonComponent(el)
					.setIcon("notebook-pen")
					.setTooltip(t("Capture"))
					.onClick(() => {
						const modal = new QuickCaptureModal(
							this.plugin.app,
							this.plugin,
							{},
							true
						);
						modal.open();
					});
			}
		);

		this.register(() => {
			this.tabActionButton.detach();
		});

		this.checkAndCollapseSidebar();

		// 添加视图切换命令
		this.plugin.settings.viewConfiguration.forEach((view) => {
			this.plugin.addCommand({
				id: `switch-view-${view.id}`,
				name: view.name,
				checkCallback: (checking) => {
					if (checking) {
						return true;
					}

					const existingLeaves =
						this.plugin.app.workspace.getLeavesOfType(
							TASK_VIEW_TYPE
						);
					if (existingLeaves.length > 0) {
						// Focus the existing view
						this.plugin.app.workspace.revealLeaf(existingLeaves[0]);
						const currentView = existingLeaves[0].view as TaskView;
						currentView.switchView(view.id);
					} else {
						// If no view is active, activate one and then switch
						this.plugin.activateTaskView().then(() => {
							const newView =
								this.plugin.app.workspace.getActiveViewOfType(
									TaskView
								);
							if (newView) {
								newView.switchView(view.id);
							}
						});
					}

					return true;
				},
			});
		});

		// 确保重置筛选器按钮正确显示
		this.updateActionButtons();
	}

	onResize(): void {
		this.checkAndCollapseSidebar();
	}

	checkAndCollapseSidebar() {
		if (this.leaf.width === 0 || this.leaf.height === 0) {
			return;
		}

		if (this.leaf.width < 768) {
			this.isSidebarCollapsed = true;
			this.sidebarComponent.setCollapsed(true);
		} else {
		}
	}

	private initializeComponents() {
		this.sidebarComponent = new SidebarComponent(
			this.rootContainerEl,
			this.plugin
		);
		this.addChild(this.sidebarComponent);
		this.sidebarComponent.load();

		this.createSidebarToggle();

		this.contentComponent = new ContentComponent(
			this.rootContainerEl,
			this.plugin.app,
			this.plugin,
			{
				onTaskSelected: (task: Task | null) => {
					this.handleTaskSelection(task);
				},
				onTaskCompleted: (task: Task) => {
					this.toggleTaskCompletion(task);
				},
				onTaskUpdate: async (originalTask: Task, updatedTask: Task) => {
					console.log(
						"TaskView onTaskUpdate",
						originalTask.content,
						updatedTask.content
					);
					await this.handleTaskUpdate(originalTask, updatedTask);
				},
				onTaskContextMenu: (event: MouseEvent, task: Task) => {
					this.handleTaskContextMenu(event, task);
				},
			}
		);
		this.addChild(this.contentComponent);
		this.contentComponent.load();

		this.forecastComponent = new ForecastComponent(
			this.rootContainerEl,
			this.plugin.app,
			this.plugin,
			{
				onTaskSelected: (task: Task | null) => {
					this.handleTaskSelection(task);
				},
				onTaskCompleted: (task: Task) => {
					this.toggleTaskCompletion(task);
				},
				onTaskUpdate: async (originalTask: Task, updatedTask: Task) => {
					console.log(
						"TaskView onTaskUpdate",
						originalTask.content,
						updatedTask.content
					);
					await this.handleTaskUpdate(originalTask, updatedTask);
				},
				onTaskContextMenu: (event: MouseEvent, task: Task) => {
					this.handleTaskContextMenu(event, task);
				},
			}
		);
		this.addChild(this.forecastComponent);
		this.forecastComponent.load();
		this.forecastComponent.containerEl.hide();

		this.tagsComponent = new TagsComponent(
			this.rootContainerEl,
			this.plugin.app,
			this.plugin,
			{
				onTaskSelected: (task: Task | null) => {
					this.handleTaskSelection(task);
				},
				onTaskCompleted: (task: Task) => {
					this.toggleTaskCompletion(task);
				},
				onTaskUpdate: async (originalTask: Task, updatedTask: Task) => {
					await this.handleTaskUpdate(originalTask, updatedTask);
				},
				onTaskContextMenu: (event: MouseEvent, task: Task) => {
					this.handleTaskContextMenu(event, task);
				},
			}
		);
		this.addChild(this.tagsComponent);
		this.tagsComponent.load();
		this.tagsComponent.containerEl.hide();

		this.projectsComponent = new ProjectsComponent(
			this.rootContainerEl,
			this.plugin.app,
			this.plugin,
			{
				onTaskSelected: (task: Task | null) => {
					this.handleTaskSelection(task);
				},
				onTaskCompleted: (task: Task) => {
					this.toggleTaskCompletion(task);
				},
				onTaskUpdate: async (originalTask: Task, updatedTask: Task) => {
					await this.handleTaskUpdate(originalTask, updatedTask);
				},
				onTaskContextMenu: (event: MouseEvent, task: Task) => {
					this.handleTaskContextMenu(event, task);
				},
			}
		);
		this.addChild(this.projectsComponent);
		this.projectsComponent.load();
		this.projectsComponent.containerEl.hide();

		this.reviewComponent = new ReviewComponent(
			this.rootContainerEl,
			this.plugin.app,
			this.plugin,
			{
				onTaskSelected: (task: Task | null) => {
					this.handleTaskSelection(task);
				},
				onTaskCompleted: (task: Task) => {
					this.toggleTaskCompletion(task);
				},
				onTaskUpdate: async (originalTask: Task, updatedTask: Task) => {
					await this.handleTaskUpdate(originalTask, updatedTask);
				},
				onTaskContextMenu: (event: MouseEvent, task: Task) => {
					this.handleTaskContextMenu(event, task);
				},
			}
		);
		this.addChild(this.reviewComponent);
		this.reviewComponent.load();
		this.reviewComponent.containerEl.hide();

		this.calendarComponent = new CalendarComponent(
			this.plugin.app,
			this.plugin,
			this.rootContainerEl,
			this.tasks,
			{
				onTaskSelected: (task: Task | null) => {
					this.handleTaskSelection(task);
				},
				onTaskCompleted: (task: Task) => {
					this.toggleTaskCompletion(task);
				},
				onEventContextMenu: (ev: MouseEvent, event: CalendarEvent) => {
					this.handleTaskContextMenu(ev, event);
				},
			}
		);
		this.addChild(this.calendarComponent);
		this.calendarComponent.load();
		this.calendarComponent.containerEl.hide();

		// Initialize KanbanComponent
		this.kanbanComponent = new KanbanComponent(
			this.app,
			this.plugin,
			this.rootContainerEl,
			this.tasks,
			{
				onTaskStatusUpdate:
					this.handleKanbanTaskStatusUpdate.bind(this),
				onTaskSelected: this.handleTaskSelection.bind(this),
				onTaskCompleted: this.toggleTaskCompletion.bind(this),
				onTaskContextMenu: this.handleTaskContextMenu.bind(this),
			}
		);
		this.addChild(this.kanbanComponent);
		this.kanbanComponent.containerEl.hide();

		this.ganttComponent = new GanttComponent(
			this.plugin,
			this.rootContainerEl,
			{
				onTaskSelected: this.handleTaskSelection.bind(this),
				onTaskCompleted: this.toggleTaskCompletion.bind(this),
				onTaskContextMenu: this.handleTaskContextMenu.bind(this),
			}
		);
		this.addChild(this.ganttComponent);
		this.ganttComponent.containerEl.hide();

		this.habitComponent = new Habit(this.plugin, this.rootContainerEl);
		this.addChild(this.habitComponent);
		this.habitComponent.containerEl.hide();

		this.detailsComponent = new TaskDetailsComponent(
			this.rootContainerEl,
			this.app,
			this.plugin
		);
		this.addChild(this.detailsComponent);
		this.detailsComponent.load();

		// 初始化统一的视图组件管理器
		this.viewComponentManager = new ViewComponentManager(
			this,
			this.app,
			this.plugin,
			this.rootContainerEl,
			{
				onTaskSelected: this.handleTaskSelection.bind(this),
				onTaskCompleted: this.toggleTaskCompletion.bind(this),
				onTaskContextMenu: this.handleTaskContextMenu.bind(this),
				onTaskStatusUpdate:
					this.handleKanbanTaskStatusUpdate.bind(this),
				onEventContextMenu: this.handleTaskContextMenu.bind(this),
				onTaskUpdate: this.handleTaskUpdate.bind(this),
			}
		);

		this.addChild(this.viewComponentManager);

		this.setupComponentEvents();
	}

	private createSidebarToggle() {
		const toggleContainer = (
			this.headerEl.find(".view-header-nav-buttons") as HTMLElement
		)?.createDiv({
			cls: "panel-toggle-container",
		});

		if (!toggleContainer) {
			console.error(
				"Could not find .view-header-nav-buttons to add sidebar toggle."
			);
			return;
		}

		this.sidebarToggleBtn = toggleContainer.createDiv({
			cls: "panel-toggle-btn",
		});
		new ButtonComponent(this.sidebarToggleBtn)
			.setIcon("panel-left-dashed")
			.setTooltip(t("Toggle Sidebar"))
			.setClass("clickable-icon")
			.onClick(() => {
				this.toggleSidebar();
			});
	}

	private createActionButtons() {
		this.detailsToggleBtn = this.addAction(
			"panel-right-dashed",
			t("Details"),
			() => {
				this.toggleDetailsVisibility(!this.isDetailsVisible);
			}
		);

		this.detailsToggleBtn.toggleClass("panel-toggle-btn", true);
		this.detailsToggleBtn.toggleClass("is-active", this.isDetailsVisible);

		this.addAction("notebook-pen", t("Capture"), () => {
			const modal = new QuickCaptureModal(
				this.plugin.app,
				this.plugin,
				{},
				true
			);
			modal.open();
		});

		this.addAction("filter", t("Filter"), (e) => {
			if (Platform.isDesktop) {
				const popover = new ViewTaskFilterPopover(
					this.plugin.app,
					undefined,
					this.plugin
				);

				// 设置关闭回调 - 现在主要用于处理取消操作
				popover.onClose = (filterState) => {
					// 由于使用了实时事件监听，这里不需要再手动更新状态
					// 可以用于处理特殊的关闭逻辑，如果需要的话
				};

				// 当打开时，设置初始过滤器状态
				this.app.workspace.onLayoutReady(() => {
					setTimeout(() => {
						if (
							this.liveFilterState &&
							popover.taskFilterComponent
						) {
							// 使用类型断言解决非空问题
							const filterState = this
								.liveFilterState as RootFilterState;
							popover.taskFilterComponent.loadFilterState(
								filterState
							);
						}
					}, 100);
				});

				popover.showAtPosition({ x: e.clientX, y: e.clientY });
			} else {
				const modal = new ViewTaskFilterModal(
					this.plugin.app,
					this.leaf.id,
					this.plugin
				);

				// 设置关闭回调 - 现在主要用于处理取消操作
				modal.filterCloseCallback = (filterState) => {
					// 由于使用了实时事件监听，这里不需要再手动更新状态
					// 可以用于处理特殊的关闭逻辑，如果需要的话
				};

				modal.open();

				// 设置初始过滤器状态
				if (this.liveFilterState && modal.taskFilterComponent) {
					setTimeout(() => {
						// 使用类型断言解决非空问题
						const filterState = this
							.liveFilterState as RootFilterState;
						modal.taskFilterComponent.loadFilterState(filterState);
					}, 100);
				}
			}
		});

		// 重置筛选器按钮的逻辑移到updateActionButtons方法中
		this.updateActionButtons();
	}

	// 添加应用当前过滤器状态的方法
	private applyCurrentFilter() {
		console.log(
			"应用当前过滤状态:",
			this.liveFilterState ? "有实时筛选器" : "无实时筛选器",
			this.currentFilterState ? "有过滤器" : "无过滤器"
		);
		// 通过triggerViewUpdate重新加载任务
		this.triggerViewUpdate();
	}

	onPaneMenu(menu: Menu) {
		// Add saved filters section
		const savedConfigs = this.plugin.settings.filterConfig.savedConfigs;
		if (savedConfigs && savedConfigs.length > 0) {
			menu.addItem((item) => {
				item.setTitle(t("Saved Filters"));
				item.setIcon("filter");
				const submenu = item.setSubmenu();

				savedConfigs.forEach((config) => {
					submenu.addItem((subItem) => {
						subItem.setTitle(config.name);
						subItem.setIcon("search");
						if (config.description) {
							subItem.setSection(config.description);
						}
						subItem.onClick(() => {
							this.applySavedFilter(config);
						});
					});
				});

				submenu.addSeparator();
				submenu.addItem((subItem) => {
					subItem.setTitle(t("Manage Saved Filters"));
					subItem.setIcon("settings");
					subItem.onClick(() => {
						const modal = new FilterConfigModal(
							this.app,
							this.plugin,
							"load",
							undefined,
							undefined,
							(config) => {
								this.applySavedFilter(config);
							}
						);
						modal.open();
					});
				});
			});
			menu.addSeparator();
		}

		if (
			this.liveFilterState &&
			this.liveFilterState.filterGroups &&
			this.liveFilterState.filterGroups.length > 0
		) {
			menu.addItem((item) => {
				item.setTitle(t("Reset Filter"));
				item.setIcon("reset");
				item.onClick(() => {
					this.resetCurrentFilter();
				});
			});
			menu.addSeparator();
		}

		menu.addItem((item) => {
			item.setTitle(t("Settings"));
			item.setIcon("gear");
			item.onClick(() => {
				this.app.setting.open();
				this.app.setting.openTabById(this.plugin.manifest.id);

				this.plugin.settingTab.openTab("view-settings");
			});
		})
			.addSeparator()
			.addItem((item) => {
				item.setTitle(t("Reindex"));
				item.setIcon("rotate-ccw");
				item.onClick(async () => {
					new ConfirmModal(this.plugin, {
						title: t("Reindex"),
						message: t(
							"Are you sure you want to force reindex all tasks?"
						),
						confirmText: t("Reindex"),
						cancelText: t("Cancel"),
						onConfirm: async (confirmed) => {
							if (!confirmed) return;
							try {
								if (this.plugin.dataflowOrchestrator) {
									await this.plugin.dataflowOrchestrator.rebuild();
								} else {
									throw new Error(
										"Dataflow orchestrator not available"
									);
								}
							} catch (error) {
								console.error(
									"Failed to force reindex tasks:",
									error
								);
								new Notice(t("Failed to force reindex tasks"));
							}
						},
					}).open();
				});
			});

		return menu;
	}

	private toggleSidebar() {
		this.isSidebarCollapsed = !this.isSidebarCollapsed;
		this.rootContainerEl.toggleClass(
			"sidebar-collapsed",
			this.isSidebarCollapsed
		);

		this.sidebarComponent.setCollapsed(this.isSidebarCollapsed);
	}

	private toggleDetailsVisibility(visible: boolean) {
		this.isDetailsVisible = visible;
		this.rootContainerEl.toggleClass("details-visible", visible);
		this.rootContainerEl.toggleClass("details-hidden", !visible);

		this.detailsComponent.setVisible(visible);
		if (this.detailsToggleBtn) {
			this.detailsToggleBtn.toggleClass("is-active", visible);
			this.detailsToggleBtn.setAttribute(
				"aria-label",
				visible ? t("Hide Details") : t("Show Details")
			);
		}

		if (!visible) {
			this.currentSelectedTaskId = null;
		}
	}

	private setupComponentEvents() {
		this.detailsComponent.onTaskToggleComplete = (task: Task) =>
			this.toggleTaskCompletion(task);

		// Details component handlers
		this.detailsComponent.onTaskEdit = (task: Task) => this.editTask(task);
		this.detailsComponent.onTaskUpdate = async (
			originalTask: Task,
			updatedTask: Task
		) => {
			console.log(
				"triggered by detailsComponent",
				originalTask,
				updatedTask
			);
			await this.updateTask(originalTask, updatedTask);
		};
		this.detailsComponent.toggleDetailsVisibility = (visible: boolean) => {
			this.toggleDetailsVisibility(visible);
		};

		// Sidebar component handlers
		this.sidebarComponent.onProjectSelected = (project: string) => {
			this.switchView("projects", project);
		};
		this.sidebarComponent.onViewModeChanged = (viewId: ViewMode) => {
			this.switchView(viewId);
		};
	}

	private switchView(
		viewId: ViewMode,
		project?: string | null,
		forceRefresh: boolean = false
	) {
		this.currentViewId = viewId;
		console.log(
			"[TaskView] Switching view to:",
			viewId,
			"Project:",
			project,
			"ForceRefresh:",
			forceRefresh
		);

		// Update sidebar to reflect current view
		this.sidebarComponent.setViewMode(viewId);

		// Hide all components first
		this.contentComponent.containerEl.hide();
		this.forecastComponent.containerEl.hide();
		this.tagsComponent.containerEl.hide();
		this.projectsComponent.containerEl.hide();
		this.reviewComponent.containerEl.hide();
		// Hide any visible TwoColumnView components
		this.twoColumnViewComponents.forEach((component) => {
			component.containerEl.hide();
		});
		// Hide all special view components
		this.viewComponentManager.hideAllComponents();
		this.habitComponent.containerEl.hide();
		this.calendarComponent.containerEl.hide();
		this.kanbanComponent.containerEl.hide();
		this.ganttComponent.containerEl.hide();

		let targetComponent: any = null;
		let modeForComponent: ViewMode = viewId;

		// Get view configuration to check for specific view types
		const viewConfig = getViewSettingOrDefault(this.plugin, viewId);

		// Handle TwoColumn views
		if (viewConfig.specificConfig?.viewType === "twocolumn") {
			// Get or create TwoColumnView component
			if (!this.twoColumnViewComponents.has(viewId)) {
				// Create a new TwoColumnView component
				const twoColumnConfig =
					viewConfig.specificConfig as TwoColumnSpecificConfig;
				const twoColumnComponent = new TaskPropertyTwoColumnView(
					this.rootContainerEl,
					this.app,
					this.plugin,
					twoColumnConfig,
					viewId
				);
				this.addChild(twoColumnComponent);

				// Set up event handlers
				twoColumnComponent.onTaskSelected = (task) => {
					this.handleTaskSelection(task);
				};
				twoColumnComponent.onTaskCompleted = (task) => {
					this.toggleTaskCompletion(task);
				};
				twoColumnComponent.onTaskContextMenu = (event, task) => {
					this.handleTaskContextMenu(event, task);
				};

				// Store for later use
				this.twoColumnViewComponents.set(viewId, twoColumnComponent);
			}

			// Get the component to display
			targetComponent = this.twoColumnViewComponents.get(viewId);
		} else {
			// 检查特殊视图类型（基于 specificConfig 或原始 viewId）
			const specificViewType = viewConfig.specificConfig?.viewType;

			// 检查是否为特殊视图，使用统一管理器处理
			if (this.viewComponentManager.isSpecialView(viewId)) {
				targetComponent =
					this.viewComponentManager.showComponent(viewId);
			} else if (
				specificViewType === "forecast" ||
				viewId === "forecast"
			) {
				targetComponent = this.forecastComponent;
			} else {
				// Standard view types
				switch (viewId) {
					case "habit":
						targetComponent = this.habitComponent;
						break;
					case "tags":
						targetComponent = this.tagsComponent;
						break;
					case "projects":
						targetComponent = this.projectsComponent;
						break;
					case "review":
						targetComponent = this.reviewComponent;
						break;
					case "inbox":
					case "flagged":
					default:
						targetComponent = this.contentComponent;
						modeForComponent = viewId;
						break;
				}
			}
		}

		if (targetComponent) {
			console.log(
				`Activating component for view ${viewId}`,
				targetComponent.constructor.name
			);
			targetComponent.containerEl.show();
			if (typeof targetComponent.setTasks === "function") {
				// 使用高级过滤器状态，确保传递有效的过滤器
				const filterOptions: {
					advancedFilter?: RootFilterState;
					textQuery?: string;
				} = {};
				if (
					this.currentFilterState &&
					this.currentFilterState.filterGroups &&
					this.currentFilterState.filterGroups.length > 0
				) {
					console.log("应用高级筛选器到视图:", viewId);
					filterOptions.advancedFilter = this.currentFilterState;
				}

				console.log("tasks", this.tasks);

				let filteredTasks = filterTasks(
					this.tasks,
					viewId,
					this.plugin,
					filterOptions
				);

				// Filter out badge tasks for forecast view - they should only appear in event view
				if (viewId === "forecast") {
					filteredTasks = filteredTasks.filter(
						(task) => !(task as any).badge
					);
				}

				console.log(
					"[TaskView] Calling setTasks with",
					filteredTasks.length,
					"filtered tasks, forceRefresh:",
					forceRefresh
				);
				targetComponent.setTasks(
					filteredTasks,
					this.tasks,
					forceRefresh
				);
			}

			// Handle updateTasks method for table view adapter
			if (typeof targetComponent.updateTasks === "function") {
				const filterOptions: {
					advancedFilter?: RootFilterState;
					textQuery?: string;
				} = {};
				if (
					this.currentFilterState &&
					this.currentFilterState.filterGroups &&
					this.currentFilterState.filterGroups.length > 0
				) {
					console.log("应用高级筛选器到表格视图:", viewId);
					filterOptions.advancedFilter = this.currentFilterState;
				}

				targetComponent.updateTasks(
					filterTasks(this.tasks, viewId, this.plugin, filterOptions)
				);
			}

			if (typeof targetComponent.setViewMode === "function") {
				console.log(
					`Setting view mode for ${viewId} to ${modeForComponent} with project ${project}`
				);
				targetComponent.setViewMode(modeForComponent, project);
			}

			this.twoColumnViewComponents.forEach((component) => {
				if (
					component &&
					typeof component.setTasks === "function" &&
					component.getViewId() === viewId
				) {
					const filterOptions: {
						advancedFilter?: RootFilterState;
						textQuery?: string;
					} = {};
					if (
						this.currentFilterState &&
						this.currentFilterState.filterGroups &&
						this.currentFilterState.filterGroups.length > 0
					) {
						filterOptions.advancedFilter = this.currentFilterState;
					}

					let filteredTasks = filterTasks(
						this.tasks,
						component.getViewId(),
						this.plugin,
						filterOptions
					);

					// Filter out badge tasks for forecast view - they should only appear in event view
					if (component.getViewId() === "forecast") {
						filteredTasks = filteredTasks.filter(
							(task) => !(task as any).badge
						);
					}

					component.setTasks(filteredTasks);
				}
			});
			if (
				viewId === "review" &&
				typeof targetComponent.refreshReviewSettings === "function"
			) {
				targetComponent.refreshReviewSettings();
			}
		} else {
			console.warn(`No target component found for viewId: ${viewId}`);
		}

		this.app.saveLocalStorage("task-genius:view-mode", viewId);
		this.updateHeaderDisplay();

		// Only clear task selection if we're changing views, not when refreshing the same view
		// This preserves the details panel when updating task status
		if (this.currentSelectedTaskId) {
			// Re-select the current task to maintain details panel visibility
			const currentTask = this.tasks.find(
				(t) => t.id === this.currentSelectedTaskId
			);
			if (currentTask) {
				this.detailsComponent.showTaskDetails(currentTask);
			} else {
				// Task no longer exists or is filtered out
				this.handleTaskSelection(null);
			}
		}

		if (this.leaf.tabHeaderInnerIconEl) {
			setIcon(this.leaf.tabHeaderInnerIconEl, this.getIcon());
			this.leaf.tabHeaderInnerTitleEl.setText(this.getDisplayText());
			this.titleEl.setText(this.getDisplayText());
		}
	}

	private updateHeaderDisplay() {
		const config = getViewSettingOrDefault(this.plugin, this.currentViewId);
		this.leaf.setEphemeralState({ title: config.name, icon: config.icon });
	}

	private handleTaskContextMenu(event: MouseEvent, task: Task) {
		const menu = new Menu();

		menu.addItem((item) => {
			item.setTitle(t("Complete"));
			item.setIcon("check-square");
			item.onClick(() => {
				this.toggleTaskCompletion(task);
			});
		})
			.addItem((item) => {
				item.setIcon("square-pen");
				item.setTitle(t("Switch status"));
				const submenu = item.setSubmenu();

				// Get unique statuses from taskStatusMarks
				const statusMarks = this.plugin.settings.taskStatusMarks;
				const uniqueStatuses = new Map<string, string>();

				// Build a map of unique mark -> status name to avoid duplicates
				for (const status of Object.keys(statusMarks)) {
					const mark =
						statusMarks[status as keyof typeof statusMarks];
					// If this mark is not already in the map, add it
					// This ensures each mark appears only once in the menu
					if (!Array.from(uniqueStatuses.values()).includes(mark)) {
						uniqueStatuses.set(status, mark);
					}
				}

				// Create menu items from unique statuses
				for (const [status, mark] of uniqueStatuses) {
					submenu.addItem((item) => {
						item.titleEl.createEl(
							"span",
							{
								cls: "status-option-checkbox",
							},
							(el) => {
								createTaskCheckbox(mark, task, el);
							}
						);
						item.titleEl.createEl("span", {
							cls: "status-option",
							text: status,
						});
						item.onClick(async () => {
							console.log("status", status, mark);
							const updatedTask = {
								...task,
								status: mark,
								completed:
									mark.toLowerCase() === "x" ? true : false,
							};

							if (!task.completed && mark.toLowerCase() === "x") {
								updatedTask.metadata.completedDate = Date.now();
							} else if (
								task.completed &&
								mark.toLowerCase() !== "x"
							) {
								updatedTask.metadata.completedDate = undefined;
							}

							await this.updateTask(task, updatedTask);
						});
					});
				}
			})
			.addSeparator()
			.addItem((item) => {
				item.setTitle(t("Edit"));
				item.setIcon("pencil");
				item.onClick(() => {
					this.handleTaskSelection(task);
				});
			})
			.addItem((item) => {
				item.setTitle(t("Edit in File"));
				item.setIcon("pencil");
				item.onClick(() => {
					this.editTask(task);
				});
			})
			.addSeparator()
			.addItem((item) => {
				item.setTitle(t("Delete Task"));
				item.setIcon("trash");
				item.onClick(() => {
					this.confirmAndDeleteTask(event, task);
				});
			});

		menu.showAtMouseEvent(event);
	}

	private handleTaskSelection(task: Task | null) {
		if (task) {
			const now = Date.now();
			const timeSinceLastToggle = now - this.lastToggleTimestamp;

			if (this.currentSelectedTaskId !== task.id) {
				this.currentSelectedTaskId = task.id;
				this.detailsComponent.showTaskDetails(task);
				if (!this.isDetailsVisible) {
					this.toggleDetailsVisibility(true);
				}
				this.lastToggleTimestamp = now;
				return;
			}

			if (timeSinceLastToggle > 150) {
				this.toggleDetailsVisibility(!this.isDetailsVisible);
				this.lastToggleTimestamp = now;
			}
		} else {
			this.toggleDetailsVisibility(false);
			this.currentSelectedTaskId = null;
		}
	}

	private async loadTasks(
		forceSync: boolean = false,
		skipViewUpdate: boolean = false
	) {
		// Only use dataflow - TaskManager is deprecated
		if (!this.plugin.dataflowOrchestrator) {
			console.warn(
				"[TaskView] Dataflow orchestrator not available, waiting for initialization..."
			);
			this.tasks = [];
		} else {
			try {
				console.log(
					"[TaskView] Loading tasks from dataflow orchestrator..."
				);
				const queryAPI = this.plugin.dataflowOrchestrator.getQueryAPI();
				this.tasks = await queryAPI.getAllTasks();
				console.log(
					`[TaskView] Loaded ${this.tasks.length} tasks from dataflow`
				);
			} catch (error) {
				console.error(
					"[TaskView] Error loading tasks from dataflow:",
					error
				);
				this.tasks = [];
			}
		}

		if (!skipViewUpdate) {
			await this.triggerViewUpdate();
		}
	}

	/**
	 * Load tasks fast using cached data - for UI initialization
	 */
	private async loadTasksFast(skipViewUpdate: boolean = false) {
		// Only use dataflow
		if (!this.plugin.dataflowOrchestrator) {
			console.warn(
				"[TaskView] Dataflow orchestrator not available for fast load"
			);
			this.tasks = [];
		} else {
			try {
				console.log(
					"[TaskView] Loading tasks fast from dataflow orchestrator..."
				);
				const queryAPI = this.plugin.dataflowOrchestrator.getQueryAPI();
				// For fast loading, use regular getAllTasks (it should be cached)
				this.tasks = await queryAPI.getAllTasks();
				console.log(
					`[TaskView] Loaded ${this.tasks.length} tasks (fast from dataflow)`
				);
			} catch (error) {
				console.error(
					"[TaskView] Error loading tasks fast from dataflow:",
					error
				);
				this.tasks = [];
			}
		}

		if (!skipViewUpdate) {
			await this.triggerViewUpdate();
		}
	}

	/**
	 * Load tasks with sync in background - non-blocking
	 */
	private async loadTasksWithSyncInBackground() {
		// Only use dataflow, ICS events are handled through dataflow architecture
		try {
			const queryAPI = this.plugin.dataflowOrchestrator?.getQueryAPI();
			if (!queryAPI) {
				console.warn("[TaskView] QueryAPI not available");
				return;
			}
			const tasks = await queryAPI.getAllTasks();
			if (tasks.length !== this.tasks.length || tasks.length === 0) {
				this.tasks = tasks;
				console.log(
					`TaskView updated with ${this.tasks.length} tasks (dataflow sync)`
				);
				// Don't trigger view update here as it will be handled by events
			}
		} catch (error) {
			console.warn("Background task sync failed:", error);
		}
	}

	public async triggerViewUpdate() {
		// 始终先刷新侧边栏项目，以反映可见性/顺序的变更
		try {
			if (
				this.sidebarComponent &&
				typeof this.sidebarComponent.renderSidebarItems === "function"
			) {
				this.sidebarComponent.renderSidebarItems();
			}
		} catch (e) {
			console.warn("Failed to refresh sidebar items:", e);
		}

		// 如果当前视图已被设置为隐藏，则切换到第一个可见视图
		const currentCfg = this.plugin.settings.viewConfiguration.find(
			(v) => v.id === this.currentViewId
		);
		if (!currentCfg?.visible) {
			const firstVisible = this.plugin.settings.viewConfiguration.find(
				(v) => v.visible
			)?.id as ViewMode | undefined;
			if (firstVisible && firstVisible !== this.currentViewId) {
				this.currentViewId = firstVisible;
				this.sidebarComponent?.setViewMode(this.currentViewId);
			}
		}

		// 直接使用（可能已更新的）当前视图重新加载
		this.switchView(this.currentViewId);

		// 更新操作按钮，确保重置筛选器按钮根据最新状态显示
		this.updateActionButtons();
	}

	private updateActionButtons() {
		// 移除过滤器重置按钮（如果存在）
		const resetButton = this.leaf.view.containerEl.querySelector(
			".view-action.task-filter-reset"
		);
		if (resetButton) {
			resetButton.remove();
		}

		// 只有在有实时高级筛选器时才添加重置按钮（不包括基础过滤器）
		if (
			this.liveFilterState &&
			this.liveFilterState.filterGroups &&
			this.liveFilterState.filterGroups.length > 0
		) {
			this.addAction("reset", t("Reset Filter"), () => {
				this.resetCurrentFilter();
			}).addClass("task-filter-reset");
		}
	}

	private async toggleTaskCompletion(task: Task) {
		const updatedTask = { ...task, completed: !task.completed };

		if (updatedTask.completed) {
			updatedTask.metadata.completedDate = Date.now();
			const completedMark = (
				this.plugin.settings.taskStatuses.completed || "x"
			).split("|")[0];
			if (updatedTask.status !== completedMark) {
				updatedTask.status = completedMark;
			}
		} else {
			updatedTask.metadata.completedDate = undefined;
			const notStartedMark =
				this.plugin.settings.taskStatuses.notStarted || " ";
			if (updatedTask.status.toLowerCase() === "x") {
				updatedTask.status = notStartedMark;
			}
		}

		// Use updateTask instead of directly calling taskManager to ensure view refresh
		await this.updateTask(task, updatedTask);
	}

	/**
	 * Extract only the fields that have changed between two tasks
	 */
	private extractChangedFields(
		originalTask: Task,
		updatedTask: Task
	): Partial<Task> {
		const changes: Partial<Task> = {};

		// Check top-level fields
		if (originalTask.content !== updatedTask.content) {
			changes.content = updatedTask.content;
		}
		if (originalTask.completed !== updatedTask.completed) {
			changes.completed = updatedTask.completed;
		}
		if (originalTask.status !== updatedTask.status) {
			changes.status = updatedTask.status;
		}

		// Check metadata fields
		const metadataChanges: Partial<typeof originalTask.metadata> = {};
		let hasMetadataChanges = false;

		// Compare each metadata field
		const metadataFields = [
			"priority",
			"project",
			"tags",
			"context",
			"dueDate",
			"startDate",
			"scheduledDate",
			"completedDate",
			"recurrence",
		];
		for (const field of metadataFields) {
			const originalValue = (originalTask.metadata as any)?.[field];
			const updatedValue = (updatedTask.metadata as any)?.[field];

			// Handle arrays specially (tags)
			if (field === "tags") {
				const origTags = originalValue || [];
				const updTags = updatedValue || [];
				if (
					origTags.length !== updTags.length ||
					!origTags.every((t: string, i: number) => t === updTags[i])
				) {
					metadataChanges.tags = updTags;
					hasMetadataChanges = true;
				}
			} else if (originalValue !== updatedValue) {
				(metadataChanges as any)[field] = updatedValue;
				hasMetadataChanges = true;
			}
		}

		// Only include metadata if there are changes
		if (hasMetadataChanges) {
			changes.metadata = metadataChanges as any;
		}

		return changes;
	}

	private async handleTaskUpdate(originalTask: Task, updatedTask: Task) {
		if (!this.plugin.writeAPI) {
			console.error("WriteAPI not available");
			return;
		}

		console.log(
			"handleTaskUpdate",
			originalTask.content,
			updatedTask.content,
			originalTask.id,
			updatedTask.id,
			updatedTask,
			originalTask
		);

		try {
			// Extract only the changed fields
			const updates = this.extractChangedFields(
				originalTask,
				updatedTask
			);
			console.log("Extracted changes:", updates);

			// Always use WriteAPI with only the changed fields
			// Use originalTask.id to ensure we're updating the correct task
			const writeResult = await this.plugin.writeAPI.updateTask({
				taskId: originalTask.id,
				updates: updates,
			});
			if (!writeResult.success) {
				throw new Error(writeResult.error || "Failed to update task");
			}
			// Prefer the authoritative task returned by WriteAPI (includes updated originalMarkdown)
			if (writeResult.task) {
				updatedTask = writeResult.task;
			}

			console.log(
				`Task ${updatedTask.id} updated successfully via handleTaskUpdate.`
			);

			// Update local task list immediately
			const index = this.tasks.findIndex((t) => t.id === originalTask.id);
			if (index !== -1) {
				// Create a new array to ensure ContentComponent detects the change
				this.tasks = [...this.tasks];
				this.tasks[index] = updatedTask;
			} else {
				console.warn(
					"Updated task not found in local list, might reload."
				);
			}

			// Always refresh the view after a successful update
			// The update operation itself means editing is complete
			// Force refresh since we know the task has been updated
			this.switchView(this.currentViewId, undefined, true);

			// Update details component if the updated task is currently selected
			if (this.currentSelectedTaskId === updatedTask.id) {
				if (this.detailsComponent.isCurrentlyEditing()) {
					// Update the current task reference without re-rendering UI
					this.detailsComponent.currentTask = updatedTask;
				} else {
					this.detailsComponent.showTaskDetails(updatedTask);
				}
			}
		} catch (error) {
			console.error("Failed to update task:", error);
			// Re-throw the error so that the InlineEditor can handle it properly
			throw error;
		}
	}

	private async updateTask(
		originalTask: Task,
		updatedTask: Task
	): Promise<Task> {
		if (!this.plugin.writeAPI) {
			console.error("WriteAPI not available for updateTask");
			throw new Error("WriteAPI not available");
		}
		try {
			// Extract only the changed fields
			const updates = this.extractChangedFields(
				originalTask,
				updatedTask
			);
			console.log("Extracted changes:", updates);

			// Always use WriteAPI with only the changed fields
			// Use originalTask.id to ensure we're updating the correct task
			const writeResult = await this.plugin.writeAPI.updateTask({
				taskId: originalTask.id,
				updates: updates,
			});
			if (!writeResult.success) {
				throw new Error(writeResult.error || "Failed to update task");
			}
			if (writeResult.task) {
				updatedTask = writeResult.task;
			}
			console.log(`Task ${updatedTask.id} updated successfully.`);

			// 立即更新本地任务列表
			const index = this.tasks.findIndex((t) => t.id === originalTask.id);
			if (index !== -1) {
				// Create a new array to ensure ContentComponent detects the change
				this.tasks = [...this.tasks];
				this.tasks[index] = updatedTask;
			} else {
				console.warn(
					"Updated task not found in local list, might reload."
				);
			}

			// Always refresh the view after a successful update
			// The update operation itself means editing is complete
			// Force refresh since we know the task has been updated
			this.switchView(this.currentViewId, undefined, true);

			if (this.currentSelectedTaskId === updatedTask.id) {
				if (this.detailsComponent.isCurrentlyEditing()) {
					// Update the current task reference without re-rendering UI
					this.detailsComponent.currentTask = updatedTask;
				} else {
					this.detailsComponent.showTaskDetails(updatedTask);
				}
			}

			return updatedTask;
		} catch (error) {
			console.error(`Failed to update task ${originalTask.id}:`, error);
			throw error;
		}
	}

	private async editTask(task: Task) {
		const file = this.app.vault.getFileByPath(task.filePath);
		if (!(file instanceof TFile)) return;

		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file, {
			eState: {
				line: task.line,
			},
		});
	}

	private async confirmAndDeleteTask(event: MouseEvent, task: Task) {
		// Check if the task has children
		const hasChildren =
			task.metadata &&
			task.metadata.children &&
			task.metadata.children.length > 0;

		if (hasChildren) {
			// Show confirmation dialog with options for tasks with children
			const childrenCount = task.metadata.children.length;
			// Create a custom modal for three-button scenario
			const menu = new Menu();
			menu.addItem((item) => {
				item.setTitle(t("Delete task only"));
				item.setIcon("trash");
				item.onClick(() => {
					this.deleteTask(task, false);
				});
			});
			menu.addItem((item) => {
				item.setTitle(t("Delete task and all subtasks"));
				item.setIcon("trash-2");
				item.onClick(() => {
					this.deleteTask(task, true);
				});
			});
			menu.addSeparator();
			menu.addItem((item) => {
				item.setTitle(t("Cancel"));
				item.onClick(() => {
					// Do nothing
				});
			});

			// Show menu at current mouse position
			menu.showAtMouseEvent(event);
		} else {
			// No children, use simple confirmation
			const modal = new ConfirmModal(this.plugin, {
				title: t("Delete Task"),
				message: t("Are you sure you want to delete this task?"),
				confirmText: t("Delete"),
				cancelText: t("Cancel"),
				onConfirm: (confirmed) => {
					if (confirmed) {
						this.deleteTask(task, false);
					}
				},
			});
			modal.open();
		}
	}

	private async deleteTask(task: Task, deleteChildren: boolean) {
		if (!this.plugin.writeAPI) {
			console.error("WriteAPI not available for deleteTask");
			new Notice(t("Failed to delete task"));
			return;
		}

		try {
			const result = await this.plugin.writeAPI.deleteTask({
				taskId: task.id,
				deleteChildren: deleteChildren,
			});

			if (result.success) {
				new Notice(t("Task deleted"));

				// Remove task from local list
				const index = this.tasks.findIndex((t) => t.id === task.id);
				if (index !== -1) {
					this.tasks = [...this.tasks];
					this.tasks.splice(index, 1);

					// If deleteChildren, also remove children from local list
					if (deleteChildren && task.metadata?.children) {
						for (const childId of task.metadata.children) {
							const childIndex = this.tasks.findIndex(
								(t) => t.id === childId
							);
							if (childIndex !== -1) {
								this.tasks.splice(childIndex, 1);
							}
						}
					}
				}

				// Clear selection if deleted task was selected
				if (this.currentSelectedTaskId === task.id) {
					this.handleTaskSelection(null);
				}

				// Refresh current view
				this.switchView(this.currentViewId, undefined, true);
			} else {
				new Notice(
					t("Failed to delete task") +
						": " +
						(result.error || "Unknown error")
				);
			}
		} catch (error) {
			console.error("Error deleting task:", error);
			new Notice(t("Failed to delete task") + ": " + error.message);
		}
	}

	async onClose() {
		// Cleanup TwoColumnView components
		this.twoColumnViewComponents.forEach((component) => {
			this.removeChild(component);
		});
		this.twoColumnViewComponents.clear();

		// Cleanup special view components
		// this.viewComponentManager.cleanup();

		this.unload();
		this.rootContainerEl.empty();
		this.rootContainerEl.detach();
	}

	onSettingsUpdate() {
		console.log("TaskView received settings update notification.");
		if (typeof this.sidebarComponent.renderSidebarItems === "function") {
			this.sidebarComponent.renderSidebarItems();
		} else {
			console.warn(
				"TaskView: SidebarComponent does not have renderSidebarItems method."
			);
		}

		// 检查当前视图的类型是否发生变化（比如从两列切换到单列）
		const currentViewConfig = this.plugin.settings.viewConfiguration.find(
			(v) => v.id === this.currentViewId
		);

		// 如果当前是两列视图但配置已改为非两列，需要销毁两列组件
		const currentTwoColumn = this.twoColumnViewComponents.get(
			this.currentViewId
		);
		if (
			currentTwoColumn &&
			currentViewConfig?.specificConfig?.viewType !== "twocolumn"
		) {
			// 销毁两列视图组件 - 使用 unload 方法来清理 Component
			currentTwoColumn.unload();
			this.twoColumnViewComponents.delete(this.currentViewId);
		}

		// 重新切换到当前视图以应用新配置
		this.switchView(this.currentViewId, undefined, true); // forceRefresh to apply new layout
		this.updateHeaderDisplay();
	}

	// Method to handle status updates originating from Kanban drag-and-drop
	private handleKanbanTaskStatusUpdate = async (
		taskId: string,
		newStatusMark: string
	) => {
		console.log(
			`TaskView handling Kanban status update request for ${taskId} to mark ${newStatusMark}`
		);
		const taskToUpdate = this.tasks.find((t) => t.id === taskId);

		if (taskToUpdate) {
			const isCompleted =
				newStatusMark.toLowerCase() ===
				(this.plugin.settings.taskStatuses.completed || "x")
					.split("|")[0]
					.toLowerCase();
			const completedDate = isCompleted ? Date.now() : undefined;

			if (
				taskToUpdate.status !== newStatusMark ||
				taskToUpdate.completed !== isCompleted
			) {
				try {
					await this.updateTask(taskToUpdate, {
						...taskToUpdate,
						status: newStatusMark,
						completed: isCompleted,
						metadata: {
							...taskToUpdate.metadata,
							completedDate: completedDate,
						},
					});
					console.log(
						`Task ${taskId} status update processed by TaskView.`
					);
				} catch (error) {
					console.error(
						`TaskView failed to update task status from Kanban callback for task ${taskId}:`,
						error
					);
				}
			} else {
				console.log(
					`Task ${taskId} status (${newStatusMark}) already matches, no update needed.`
				);
			}
		} else {
			console.warn(
				`TaskView could not find task with ID ${taskId} for Kanban status update.`
			);
		}
	};

	// 添加重置筛选器的方法
	public resetCurrentFilter() {
		console.log("重置实时筛选器");
		this.liveFilterState = null;
		this.currentFilterState = null;
		this.app.saveLocalStorage("task-genius-view-filter", null);
		this.applyCurrentFilter();
		this.updateActionButtons();
	}

	// 应用保存的筛选器配置
	private applySavedFilter(config: SavedFilterConfig) {
		console.log("应用保存的筛选器:", config.name);
		this.liveFilterState = JSON.parse(JSON.stringify(config.filterState));
		this.currentFilterState = JSON.parse(
			JSON.stringify(config.filterState)
		);
		console.log("applySavedFilter", this.liveFilterState);
		this.app.saveLocalStorage(
			"task-genius-view-filter",
			this.liveFilterState
		);
		this.applyCurrentFilter();
		this.updateActionButtons();
		new Notice(t("Filter applied: ") + config.name);
	}
}
