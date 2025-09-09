/**
 * Base Task Bases View
 * Abstract base class for all task-based Bases views
 * Provides common BasesView interface implementation
 *
 * Update Mechanism:
 * - Uses Bases native API (updateProperty/setValue) for task updates
 * - Maps Task metadata to appropriate Bases properties
 * - Provides error handling and user feedback for update failures
 * - Maintains local task state for UI responsiveness
 */

import { Component, App, TFile } from "obsidian";
import { Task } from "../types/task";
import TaskProgressBarPlugin from "../index";
import { ViewMode } from "../common/setting-definition";
import { TaskDetailsComponent } from "../components/features/task/view/details";
import { t } from "../translations/helper";

// Import BasesView types
interface BasesViewSettings {
	get(key: string): any;
	set(data: any): void;
	getOrder(): string[] | null;
	setOrder(order: string[]): void;
	getDisplayName(prop: any): string;
	setDisplayName(prop: any, name: string): void;
	getViewName(): string;
}

interface BasesViewData {
	entries: any[];
}

interface BasesProperty {
	name: string;
	type: string;
	dataType?: string;
}

interface BaseView {
	onload?(): void;
	onunload?(): void;
	onActionsMenu(): Array<{
		name: string;
		callback: () => void;
		icon: string;
	}>;
	onEditMenu(): Array<{
		displayName: string;
		component: (container: HTMLElement) => any;
	}>;
	onResize(): void;
}

interface BasesView extends BaseView {
	type: string;
	app: App;
	containerEl: HTMLElement;
	settings: BasesViewSettings;
	data: BasesViewData[];
	properties: BasesProperty[];
	updateConfig(settings: BasesViewSettings): void;
	updateData(properties: BasesProperty[], data: BasesViewData[]): void;
	display(): void;
}

export abstract class BaseTaskBasesView extends Component implements BasesView {
	// BasesView interface properties
	abstract type: string;
	app: App;
	containerEl: HTMLElement;
	settings: BasesViewSettings;
	data: BasesViewData[] = [];
	properties: BasesProperty[] = [];

	// Task-specific properties
	protected plugin: TaskProgressBarPlugin;
	protected tasks: Task[] = [];
	protected viewMode: ViewMode;
	protected currentTask: Task | null = null;

	// Details panel properties
	protected detailsComponent: TaskDetailsComponent;
	protected isDetailsVisible: boolean = false;
	protected currentSelectedTaskId: string | null = null;
	protected lastToggleTimestamp: number = 0;

	constructor(
		containerEl: HTMLElement,
		app: App,
		plugin: TaskProgressBarPlugin,
		viewMode: ViewMode
	) {
		super();
		this.containerEl = containerEl;
		this.app = app;
		this.plugin = plugin;
		this.viewMode = viewMode;

		// Initialize container with details support
		this.containerEl.empty();
		this.containerEl.toggleClass(
			[
				"base-task-bases-view",
				"task-genius-view",
				"task-genius-container",
				"no-sidebar",
			],
			true
		);

		// Initialize details component
		this.initializeDetailsComponent();
	}

	/**
	 * Initialize the task details component
	 */
	private initializeDetailsComponent(): void {
		this.detailsComponent = new TaskDetailsComponent(
			this.containerEl,
			this.app,
			this.plugin
		);
		this.addChild(this.detailsComponent);
		this.detailsComponent.load();

		// Setup details component events
		this.setupDetailsEvents();

		// Initially hide details
		this.toggleDetailsVisibility(false);
	}

	/**
	 * Setup details component event handlers
	 */
	private setupDetailsEvents(): void {
		this.detailsComponent.onTaskToggleComplete = (task: Task) => {
			this.handleTaskCompletion(task);
		};

		this.detailsComponent.onTaskEdit = (task: Task) => {
			this.handleTaskEdit(task);
		};

		this.detailsComponent.onTaskUpdate = async (
			originalTask: Task,
			updatedTask: Task
		) => {
			await this.handleTaskUpdate(originalTask, updatedTask);
		};

		this.detailsComponent.toggleDetailsVisibility = (visible: boolean) => {
			this.toggleDetailsVisibility(visible);
		};
	}

	/**
	 * Handle task selection - show details panel
	 */
	protected handleTaskSelection(task: Task | null): void {
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

			// Toggle details visibility on double-click/re-click
			if (timeSinceLastToggle > 150) {
				// Debounce slightly
				this.toggleDetailsVisibility(!this.isDetailsVisible);
				this.lastToggleTimestamp = now;
			}
		} else {
			// Deselecting task explicitly
			this.toggleDetailsVisibility(false);
			this.currentSelectedTaskId = null;
		}
	}

	/**
	 * Toggle details panel visibility
	 */
	protected toggleDetailsVisibility(visible: boolean): void {
		this.isDetailsVisible = visible;
		this.containerEl.toggleClass("details-visible", visible);
		this.containerEl.toggleClass("details-hidden", !visible);

		this.detailsComponent.setVisible(visible);

		if (!visible) {
			this.currentSelectedTaskId = null;
		}
	}

	/**
	 * Handle task completion
	 */
	protected async handleTaskCompletion(task: Task): Promise<void> {
		const updatedTask = { ...task, completed: !task.completed };

		if (updatedTask.completed) {
			// Set completion time
			if (updatedTask.metadata) {
				updatedTask.metadata.completedDate = Date.now();
			}
			const completedMark = (
				this.plugin.settings.taskStatuses.completed || "x"
			).split("|")[0];
			if (updatedTask.status !== completedMark) {
				updatedTask.status = completedMark;
			}
		} else {
			// Clear completion time
			if (updatedTask.metadata) {
				updatedTask.metadata.completedDate = undefined;
			}
			const notStartedMark =
				this.plugin.settings.taskStatuses.notStarted || " ";
			if (updatedTask.status.toLowerCase() === "x") {
				updatedTask.status = notStartedMark;
			}
		}

		try {
			// Use Bases native update instead of TaskManager
			await this.updateBasesEntry(task, updatedTask);

			// Update task in local list immediately for responsiveness
			const index = this.tasks.findIndex((t) => t.id === task.id);
			if (index !== -1) {
				this.tasks[index] = updatedTask;
			}

			// If this is the currently selected task, refresh details view
			if (this.currentSelectedTaskId === updatedTask.id) {
				this.detailsComponent.showTaskDetails(updatedTask);
			}

			// Trigger view update only if not currently editing in details panel
			if (!this.detailsComponent.isCurrentlyEditing()) {
				this.onDataUpdated();
			} else {
				// Update UI with the changed task data without full view refresh
				this.updateUIWithLatestTaskData();
			}
		} catch (error) {
			console.error(
				`[${this.type}] Failed to update task completion:`,
				error
			);
			// Show user-friendly error message
			this.showUpdateError(error);
		}
	}

	/**
	 * Handle task editing in file
	 */
	protected async handleTaskEdit(task: Task): Promise<void> {
		const file = this.app.vault.getFileByPath(task.filePath);
		if (!file || !(file instanceof TFile)) return;

		// Open the file
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file);

		// Try to set the cursor at the task's line
		const editor = this.app.workspace.activeEditor?.editor;
		if (editor) {
			editor.setCursor({ line: task.line || 0, ch: 0 });
			editor.focus();
		}
	}

	/**
	 * Handle task update from details panel
	 */
	protected async handleTaskUpdate(
		originalTask: Task,
		updatedTask: Task
	): Promise<void> {
		try {
			// Use Bases native update instead of TaskManager
			await this.updateBasesEntry(originalTask, updatedTask);

			// Update task in local list immediately for responsiveness
			const index = this.tasks.findIndex((t) => t.id === originalTask.id);
			if (index !== -1) {
				this.tasks[index] = updatedTask;
			}

			// If the updated task is the currently selected one, refresh details view
			// Only refresh if not currently editing to prevent UI disruption
			if (this.currentSelectedTaskId === updatedTask.id) {
				if (this.detailsComponent.isCurrentlyEditing()) {
					// Update the current task reference without re-rendering UI
					this.currentTask = updatedTask;
				} else {
					this.detailsComponent.showTaskDetails(updatedTask);
				}
			}

			// Trigger view update only if not currently editing in details panel
			if (!this.detailsComponent.isCurrentlyEditing()) {
				this.onDataUpdated();
			} else {
				// Update UI with the changed task data without full view refresh
				this.updateUIWithLatestTaskData();
			}
		} catch (error) {
			console.error(`[${this.type}] Failed to update task:`, error);
			// Show user-friendly error message
			this.showUpdateError(error);
		}
	}

	/**
	 * Update Bases entry using native Bases API
	 */
	private async updateBasesEntry(
		originalTask: Task,
		updatedTask: Task
	): Promise<void> {
		try {
			// Find the original entry that corresponds to this task
			const entry = this.findEntryByTaskId(originalTask.id);
			if (!entry) {
				throw new Error(
					`Original entry not found for task ID: ${originalTask.id}`
				);
			}

			// Debug Bases API availability
			this.debugBasesApiAvailability(entry);

			// Handle content/title updates specially based on user preferences
			if (originalTask.content !== updatedTask.content) {
				await this.handleContentUpdate(entry, originalTask, updatedTask);
			}

			// Map task metadata to Bases properties (excluding content which was handled above)
			const updates = this.mapTaskMetadataToBases(
				originalTask,
				updatedTask,
				true // exclude content from property updates
			);
			console.log(`[${this.type}] Mapped updates:`, updates);

			// Apply updates using Bases native API
			for (const [propertyName, value] of Object.entries(updates)) {
				await this.updateBasesProperty(entry, propertyName, value);
			}

			console.log(
				`[${this.type}] Successfully updated Bases entry for task ${updatedTask.id}`
			);
		} catch (error) {
			console.error(
				`[${this.type}] Failed to update Bases entry:`,
				error
			);
			throw error;
		}
	}

	/**
	 * Update a single Bases property
	 */
	private async updateBasesProperty(
		entry: any,
		propertyName: string,
		value: any
	): Promise<void> {
		try {
			console.log(
				`[${this.type}] Attempting to update property ${propertyName} with value:`,
				value
			);

			// Use Bases native updateProperty method if available
			if (typeof entry.updateProperty === "function") {
				console.log(
					`[${this.type}] Using entry.updateProperty for ${propertyName}`
				);
				await entry.updateProperty(propertyName, value);
				console.log(
					`[${this.type}] Successfully updated ${propertyName} via updateProperty`
				);
				return;
			}

			// Fallback: try to update through the entry's setValue method
			if (typeof entry.setValue === "function") {
				console.log(
					`[${this.type}] Using entry.setValue for ${propertyName}`
				);
				await entry.setValue(
					{ type: "note", name: propertyName },
					value
				);
				console.log(
					`[${this.type}] Successfully updated ${propertyName} via setValue`
				);
				return;
			}

			// If no native update method available, log warning
			console.warn(
				`[${this.type}] No native update method available for property ${propertyName}`
			);
			console.warn(
				`[${this.type}] Available entry methods:`,
				Object.keys(entry).filter(
					(key) => typeof entry[key] === "function"
				)
			);
		} catch (error) {
			console.error(
				`[${this.type}] Failed to update property ${propertyName}:`,
				error
			);
			throw error;
		}
	}

	/**
	 * Handle content/title update based on user preferences
	 */
	private async handleContentUpdate(
		entry: any,
		originalTask: Task,
		updatedTask: Task
	): Promise<void> {
		const newContent = updatedTask.content;
		
		// Get file source configuration to determine how to handle title updates
		const fileConfig = this.plugin.settings?.fileSource?.fileTaskProperties;
		const contentSource = fileConfig?.contentSource || 'title';
		const preferFrontmatterTitle = fileConfig?.preferFrontmatterTitle ?? true;
		
		console.log(`[${this.type}] Handling content update:`, {
			contentSource,
			preferFrontmatterTitle,
			newContent
		});

		try {
			// First try to update using the Bases API based on configuration
			switch (contentSource) {
				case 'title':
					if (preferFrontmatterTitle) {
						// Update frontmatter title property using Bases API
						await this.updateBasesProperty(entry, 'title', newContent);
						console.log(`[${this.type}] Updated title in frontmatter via Bases API`);
					} else {
						// Try to rename file through Bases API if supported
						// Fallback to file manager if needed
						if (!await this.tryUpdateFilenameViaBasesAPI(entry, newContent)) {
							await this.fallbackRenameFile(entry, newContent);
						}
					}
					break;
					
				case 'filename':
					// Try to rename through Bases API, fallback to direct rename
					if (!await this.tryUpdateFilenameViaBasesAPI(entry, newContent)) {
						await this.fallbackRenameFile(entry, newContent);
					}
					break;
					
				case 'h1':
					// Update H1 property if available, otherwise fallback
					if (!await this.tryUpdateH1ViaBasesAPI(entry, newContent)) {
						await this.fallbackUpdateH1(entry, newContent);
					}
					break;
					
				case 'custom':
					// Update custom field using Bases API
					const customField = fileConfig?.customContentField;
					if (customField) {
						await this.updateBasesProperty(entry, customField, newContent);
						console.log(`[${this.type}] Updated custom field '${customField}' via Bases API`);
					}
					break;
					
				default:
					// Default to updating title property
					await this.updateBasesProperty(entry, 'title', newContent);
					break;
			}
		} catch (error) {
			console.error(`[${this.type}] Failed to update content:`, error);
			// Try fallback to default update
			await this.updateBasesProperty(entry, 'title', newContent);
		}
	}

	/**
	 * Try to update filename through Bases API
	 */
	private async tryUpdateFilenameViaBasesAPI(entry: any, newContent: string): Promise<boolean> {
		try {
			// Check if Bases API supports file renaming
			if (typeof entry.renameFile === 'function') {
				await entry.renameFile(newContent);
				console.log(`[${this.type}] Renamed file via Bases API`);
				return true;
			}
			// Try updating through file.name property
			if (entry.file && typeof entry.updateProperty === 'function') {
				await entry.updateProperty('file.name', newContent);
				console.log(`[${this.type}] Updated file name via Bases property`);
				return true;
			}
		} catch (error) {
			console.log(`[${this.type}] Cannot rename via Bases API, will use fallback`);
		}
		return false;
	}

	/**
	 * Try to update H1 heading through Bases API
	 */
	private async tryUpdateH1ViaBasesAPI(entry: any, newContent: string): Promise<boolean> {
		try {
			// Try to update h1 property if it exists
			if (typeof entry.updateProperty === 'function') {
				await entry.updateProperty('h1', newContent);
				console.log(`[${this.type}] Updated H1 via Bases API`);
				return true;
			}
		} catch (error) {
			console.log(`[${this.type}] Cannot update H1 via Bases API, will use fallback`);
		}
		return false;
	}

	/**
	 * Fallback: Rename file using Obsidian's file manager
	 */
	private async fallbackRenameFile(entry: any, newContent: string): Promise<void> {
		try {
			const file = entry.file;
			if (!file || !file.path) {
				console.error(`[${this.type}] Cannot rename: no file path found`);
				return;
			}

			// Sanitize the new name
			const sanitizedName = newContent
				.replace(/[\\/:*?"<>|]/g, '-')
				.replace(/\s+/g, ' ')
				.trim();
				
			if (!sanitizedName) {
				console.error(`[${this.type}] Cannot rename: invalid new name`);
				return;
			}

			const lastSlash = file.path.lastIndexOf('/');
			const directory = lastSlash > 0 ? file.path.substring(0, lastSlash) : '';
			const extension = file.extension || 'md';
			const newPath = directory ? `${directory}/${sanitizedName}.${extension}` : `${sanitizedName}.${extension}`;
			
			const tFile = this.app.vault.getAbstractFileByPath(file.path);
			if (tFile && 'extension' in tFile) {
				await this.app.fileManager.renameFile(tFile, newPath);
				console.log(`[${this.type}] Renamed file from ${file.path} to ${newPath} using fallback`);
			}
		} catch (error) {
			console.error(`[${this.type}] Fallback rename failed:`, error);
		}
	}

	/**
	 * Fallback: Update H1 heading in file content
	 */
	private async fallbackUpdateH1(entry: any, newContent: string): Promise<void> {
		try {
			const file = entry.file;
			if (!file || !file.path) {
				console.error(`[${this.type}] Cannot update H1: no file path found`);
				return;
			}

			const tFile = this.app.vault.getAbstractFileByPath(file.path);
			if (tFile instanceof TFile) {
				const content = await this.app.vault.read(tFile);
				const updatedContent = content.replace(/^#\s+.*/m, `# ${newContent}`);
				await this.app.vault.modify(tFile, updatedContent);
				console.log(`[${this.type}] Updated H1 heading using fallback`);
			}
		} catch (error) {
			console.error(`[${this.type}] Fallback H1 update failed:`, error);
		}
	}

	/**
	 * Map Task metadata to Bases properties
	 */
	private mapTaskMetadataToBases(
		originalTask: Task,
		updatedTask: Task,
		excludeContent: boolean = false
	): Record<string, any> {
		const updates: Record<string, any> = {};

		// Check content changes (skip if handled separately)
		if (!excludeContent && originalTask.content !== updatedTask.content) {
			updates.title = updatedTask.content;
			updates.content = updatedTask.content;
		}

		// Check metadata changes
		const originalMeta = originalTask.metadata;
		const updatedMeta = updatedTask.metadata;

		// Project
		if (originalMeta.project !== updatedMeta.project) {
			updates.project = updatedMeta.project;
		}

		// Tags
		if (
			JSON.stringify(originalMeta.tags) !==
			JSON.stringify(updatedMeta.tags)
		) {
			updates.tags = updatedMeta.tags;
		}

		// Context
		if (originalMeta.context !== updatedMeta.context) {
			updates.context = updatedMeta.context;
		}

		// Priority
		if (originalMeta.priority !== updatedMeta.priority) {
			updates.priority = updatedMeta.priority;
		}

		// Dates - Update both canonical and alias properties for compatibility
		if (originalMeta.dueDate !== updatedMeta.dueDate) {
			const dateValue = updatedMeta.dueDate
				? new Date(updatedMeta.dueDate)
				: undefined;
			updates.dueDate = dateValue;
			updates.due = dateValue;
		}

		if (originalMeta.startDate !== updatedMeta.startDate) {
			const dateValue = updatedMeta.startDate
				? new Date(updatedMeta.startDate)
				: undefined;
			updates.startDate = dateValue;
			updates.start = dateValue;
		}

		if (originalMeta.scheduledDate !== updatedMeta.scheduledDate) {
			const dateValue = updatedMeta.scheduledDate
				? new Date(updatedMeta.scheduledDate)
				: undefined;
			updates.scheduledDate = dateValue;
			updates.scheduled = dateValue;
		}

		if (originalMeta.completedDate !== updatedMeta.completedDate) {
			const dateValue = updatedMeta.completedDate
				? new Date(updatedMeta.completedDate)
				: undefined;
			updates.completedDate = dateValue;
			updates.completed = dateValue;
		}

		if (originalMeta.cancelledDate !== updatedMeta.cancelledDate) {
			const dateValue = updatedMeta.cancelledDate
				? new Date(updatedMeta.cancelledDate)
				: undefined;
			updates.cancelledDate = dateValue;
			updates.cancelled = dateValue;
		}

		// Other metadata
		if (originalMeta.onCompletion !== updatedMeta.onCompletion) {
			updates.onCompletion = updatedMeta.onCompletion;
		}

		if (
			JSON.stringify(originalMeta.dependsOn) !==
			JSON.stringify(updatedMeta.dependsOn)
		) {
			updates.dependsOn = updatedMeta.dependsOn;
		}

		if (originalMeta.id !== updatedMeta.id) {
			updates.id = updatedMeta.id;
		}

		if (originalMeta.recurrence !== updatedMeta.recurrence) {
			updates.recurrence = updatedMeta.recurrence;
		}

		// Completion status
		if (originalTask.completed !== updatedTask.completed) {
			updates.completed = updatedTask.completed;
			updates.done = updatedTask.completed;
		}

		// Status
		if (originalTask.status !== updatedTask.status) {
			updates.status = updatedTask.status;
		}

		return updates;
	}

	/**
	 * Helper method to get the actual data array from this.data
	 */
	private getDataArray(): any[] {
		// Check if this.data is a wrapper object with a data property
		if (this.data && typeof this.data === 'object' && !Array.isArray(this.data)) {
			if ((this.data as any).data && Array.isArray((this.data as any).data)) {
				return (this.data as any).data;
			}
		}
		
		// If this.data is already an array, return it
		if (Array.isArray(this.data)) {
			return this.data;
		}
		
		// Default to empty array if we can't find the data
		return [];
	}

	/**
	 * Find the original Bases entry by task ID
	 */
	private findEntryByTaskId(taskId: string): any | null {
		const dataArray = this.getDataArray();
		
		if (dataArray.length === 0) {
			console.error(`[${this.type}] No data available in findEntryByTaskId`);
			return null;
		}

		// Search through the entries directly (new format)
		for (const entry of dataArray) {
			try {
				// Check if this entry corresponds to the task ID
				const entryTaskId = this.generateTaskId(entry);
				if (entryTaskId === taskId) {
					return entry;
				}
			} catch (error) {
				// Continue searching if this entry can't be processed
				continue;
			}
		}
		
		console.warn(`[${this.type}] Entry not found for task ID: ${taskId}`);
		return null;
	}

	/**
	 * Show user-friendly error message for update failures
	 */
	private showUpdateError(error: any): void {
		// Create a temporary error notification
		const errorEl = this.containerEl.createDiv({
			cls: "bases-update-error-notification",
		});

		errorEl.createDiv({
			cls: "error-icon",
			text: "⚠️",
		});

		const messageEl = errorEl.createDiv({
			cls: "error-message",
		});
		messageEl.createDiv({
			cls: "error-title",
			text: "Failed to update task",
		});
		messageEl.createDiv({
			cls: "error-details",
			text: error.message || "An unknown error occurred",
		});

		// Auto-remove after 5 seconds
		setTimeout(() => {
			if (errorEl.parentNode) {
				errorEl.remove();
			}
		}, 5000);

		// Add click to dismiss
		errorEl.addEventListener("click", () => {
			errorEl.remove();
		});
	}

	// BasesView interface implementation
	updateConfig(settings: BasesViewSettings): void {
		this.settings = settings;
		console.log(`[${this.type}] Config updated:`, settings);
		this.onConfigUpdated();
	}

	updateData(properties: any, data: any): void {
		console.log(`[${this.type}] updateData called`);
		
		// Helper function to safely stringify with circular reference handling
		const safeStringify = (obj: any, depth: number = 3) => {
			const seen = new WeakSet();
			let currentDepth = 0;
			
			return JSON.stringify(obj, function(key, value) {
				if (currentDepth > depth) {
					return '[Max Depth]';
				}
				
				if (typeof value === 'object' && value !== null) {
					// Handle circular references
					if (seen.has(value)) {
						return '[Circular Reference]';
					}
					seen.add(value);
					
					// Track depth for nested objects
					currentDepth++;
					
					// Skip certain known large/circular objects
					if (key === 'app' || key === 'ctx' || key === 'vault' || key === 'parent') {
						return '[Skipped: Large Object]';
					}
				}
				
				// Handle functions
				if (typeof value === 'function') {
					return '[Function]';
				}
				
				return value;
			}, 2);
		};
		
		console.log(`[${this.type}] First parameter (properties):`, properties);
		console.log(`[${this.type}] Second parameter (data):`, data);
		
		// Try to stringify the second parameter if it's an array
		if (Array.isArray(data) && data.length > 0) {
			console.log(`[${this.type}] First data item (JSON):`, safeStringify(data[0]));
			console.log(`[${this.type}] First 3 data items (JSON):`, safeStringify(data.slice(0, 3)));
		} else if (data && typeof data === 'object') {
			console.log(`[${this.type}] Data object structure (JSON):`, safeStringify(data));
		}
		
		// Check both parameters to find the actual data array
		let actualData: any[] = [];
		let actualProperties: any[] = [];
		
		// Check if first parameter is the data
		if (Array.isArray(properties)) {
			console.log(`[${this.type}] First parameter is an array with ${properties.length} items`);
			if (properties.length > 0 && properties[0].file) {
				console.log(`[${this.type}] First parameter appears to be the data (has file property)`);
				actualData = properties;
				actualProperties = Array.isArray(data) ? data : [];
			} else {
				actualProperties = properties;
			}
		}
		
		// Check if second parameter is the data
		if (Array.isArray(data)) {
			console.log(`[${this.type}] Second parameter is an array with ${data.length} items`);
			if (data.length > 0 && data[0].file) {
				console.log(`[${this.type}] Second parameter appears to be the data (has file property)`);
				actualData = data;
			}
		} else if (data && !Array.isArray(data)) {
			console.log(`[${this.type}] Data is not an array, checking for nested structures`);
			console.log(`[${this.type}] Data object keys:`, Object.keys(data));
			
			// Try to extract the actual data array from various possible locations
			if (data.data && Array.isArray(data.data)) {
				console.log(`[${this.type}] Found data array at data.data`);
				actualData = data.data;
			}
		}
		
		console.log(`[${this.type}] Final actualData:`, {
			isArray: Array.isArray(actualData),
			length: Array.isArray(actualData) ? actualData.length : 'N/A',
			firstItem: Array.isArray(actualData) && actualData.length > 0 ? actualData[0] : null
		});
		
		// Store the entire object if it has a data property, or the array directly
		if (data && typeof data === 'object' && !Array.isArray(data) && data.data) {
			// Store the entire wrapper object - convertEntriesToTasks will extract the array
			this.data = data;
			this.properties = properties || [];
		} else {
			this.properties = actualProperties;
			this.data = actualData;
		}
		
		console.log(`[${this.type}] this.data set, type:`, typeof this.data);
		if (Array.isArray(this.data)) {
			console.log(`[${this.type}] this.data is array with ${this.data.length} items`);
		} else if (this.data && (this.data as any).data) {
			console.log(`[${this.type}] this.data is wrapper object with data array of ${(this.data as any).data.length} items`);
		}
		console.log(`[${this.type}] this.properties set with ${this.properties.length} properties`);

		// Data has been updated, trigger the standard data update flow
		this.onDataUpdated();
	}

	display(): void {
		console.log(`[${this.type}] Displaying view`);
		this.containerEl.show();
		this.onDisplay();
	}

	// Ephemeral state methods for Obsidian view system
	getEphemeralState(): any {
		return {
			selectedTaskId: this.currentSelectedTaskId,
			detailsVisible: this.isDetailsVisible,
		};
	}

	setEphemeralState(state: any): void {
		if (state) {
			if (state.selectedTaskId) {
				this.currentSelectedTaskId = state.selectedTaskId;
			}
			if (state.detailsVisible !== undefined) {
				this.isDetailsVisible = state.detailsVisible;
			}
		}
	}

	// BaseView interface implementation
	onload(): void {
		console.log(`[${this.type}] Loading view`);
		this.onViewLoad();
	}

	onunload(): void {
		console.log(`[${this.type}] Unloading view`);
		this.onViewUnload();
		this.unload();
	}

	onActionsMenu(): Array<{
		name: string;
		callback: () => void;
		icon: string;
	}> {
		const baseActions = [
			{
				name: "Refresh Tasks",
				icon: "refresh-cw",
				callback: () => {
					this.refreshTasks();
				},
			},
		];

		const customActions = this.getCustomActions();
		return [...baseActions, ...customActions];
	}

	onEditMenu(): Array<{
		displayName: string;
		component: (container: HTMLElement) => any;
	}> {
		return this.getEditMenuItems();
	}

	onResize(): void {
		this.onViewResize();
	}

	// Protected methods for data conversion
	protected convertEntriesToTasks(): boolean {
		console.log(`[${this.type}] Converting entries to tasks`);
		console.log(`[${this.type}] Raw data:`, this.data);
		
		// Safe stringify helper
		const safeStringify = (obj: any, depth: number = 2) => {
			const seen = new WeakSet();
			let currentDepth = 0;
			
			return JSON.stringify(obj, function(key, value) {
				if (currentDepth > depth) {
					return '[Max Depth]';
				}
				
				if (typeof value === 'object' && value !== null) {
					if (seen.has(value)) {
						return '[Circular]';
					}
					seen.add(value);
					currentDepth++;
					
					// Skip large objects
					if (key === 'app' || key === 'ctx' || key === 'vault' || key === 'parent' || key === 'formulaResults') {
						return '[Skipped]';
					}
				}
				
				if (typeof value === 'function') {
					return '[Function]';
				}
				
				return value;
			}, 2);
		};
		
		// Get the actual data array using helper method
		const dataArray = this.getDataArray();
		console.log(`[${this.type}] Got data array with ${dataArray.length} items`);

		// Ensure we have data to process
		if (!dataArray || dataArray.length === 0) {
			console.log(`[${this.type}] No data available, clearing tasks`);
			this.tasks = [];
			return true;
		}

		const newTasks: Task[] = [];
		
		// Log first entry structure in JSON format
		if (dataArray.length > 0) {
			console.log(`[${this.type}] First entry (JSON):`, safeStringify(dataArray[0]));
		}

		// Process each entry - they come directly in the array with file/note/frontmatter properties
		for (let i = 0; i < dataArray.length; i++) {
			const entry = dataArray[i];
			
			// Only log first few entries to avoid spam
			if (i < 3) {
				console.log(`[${this.type}] Processing entry ${i}:`, entry);
				console.log(`[${this.type}] Entry ${i} type:`, typeof entry);
				console.log(`[${this.type}] Entry ${i} keys:`, Object.keys(entry));
			}
			
			// Check if this is a valid entry with file or note data
			const entryAsAny = entry as any;
			if (entryAsAny.file || entryAsAny.note) {
				if (i < 3) {
					console.log(`[${this.type}] Entry ${i} has file/note data, processing as task`);
				}
				try {
					const task = this.entryToTask(entry);
					if (task) {
						newTasks.push(task);
					}
				} catch (error) {
					console.error(
						`[${this.type}] Error converting entry ${i} to task:`,
						error
					);
					if (i < 3) {
						console.error(`[${this.type}] Failed entry structure:`, safeStringify(entry));
					}
				}
			}
			// Fallback: check if this is old format with entries array
			else if (entry.entries && Array.isArray(entry.entries)) {
				console.log(
					`[${this.type}] Processing ${entry.entries.length} entries from group (old format)`
				);
				for (const subEntry of entry.entries) {
					try {
						const task = this.entryToTask(subEntry);
						if (task) {
							newTasks.push(task);
						}
					} catch (error) {
						console.error(
							`[${this.type}] Error converting sub-entry to task:`,
							error,
							subEntry
						);
					}
				}
			} else {
				console.log(`[${this.type}] Skipping entry - no file/note data:`, entry);
			}
		}

		console.log(
			`[${this.type}] Converted ${newTasks.length} tasks from ${dataArray.length} data entries`
		);

		// Log sample tasks to see what was created
		if (newTasks.length > 0) {
			console.log(`[${this.type}] First 3 created tasks:`, newTasks.slice(0, 3));
			console.log(`[${this.type}] Task properties example:`, {
				id: newTasks[0].id,
				content: newTasks[0].content,
				filePath: newTasks[0].filePath,
				metadata: newTasks[0].metadata
			});
		} else {
			console.warn(`[${this.type}] WARNING: No tasks were created from ${this.data.length} data entries!`);
		}

		// Check if tasks have changed
		const hasChanged = this.hasTasksChanged(this.tasks, newTasks);
		this.tasks = newTasks;

		console.log(
			`[${this.type}] Task conversion complete. Has changes: ${hasChanged}, Total tasks: ${this.tasks.length}`
		);
		return hasChanged;
	}

	protected entryToTask(entry: any): Task | null {
		try {
			// Safe stringify for logging
			const safeStringify = (obj: any) => {
				const seen = new WeakSet();
				return JSON.stringify(obj, function(key, value) {
					if (typeof value === 'object' && value !== null) {
						if (seen.has(value)) return '[Circular]';
						seen.add(value);
						if (key === 'app' || key === 'ctx' || key === 'vault' || key === 'parent' || key === 'formulaResults') {
							return '[Skipped]';
						}
					}
					if (typeof value === 'function') return '[Function]';
					return value;
				}, 2);
			};
			
			// Only log for first few entries to reduce noise
			const shouldLog = this.tasks.length < 3;
			
			if (shouldLog) {
				console.log(`[${this.type}] Converting entry to task (JSON):`, safeStringify(entry));
			}
			
			// Extract basic file information
			let file = entry.file;
			const frontmatter = entry.frontmatter || {};
			
			// Skip non-markdown files that aren't likely to contain tasks
			if (file && file.extension) {
				if (file.extension === 'canvas' || file.extension === 'pdf' || file.extension === 'png' || file.extension === 'jpg') {
					console.log(`[${this.type}] Skipping non-task file: ${file.path} (${file.extension})`);
					return null;
				}
			}
			
			// Check if this is a special file type (like Kanban board) that shouldn't be processed as a task
			if (frontmatter['kanban-plugin'] || frontmatter['excalidraw-plugin']) {
				console.log(`[${this.type}] Skipping special plugin file: ${file?.path}`);
				return null;
			}

			if (!file) {
				console.warn(
					`[${this.type}] Entry missing file information:`,
					entry
				);
				// Check if the entry has path directly (new format)
				if (entry.path || entry.filePath) {
					console.log(`[${this.type}] Entry has direct path property, creating file object`);
					const filePath = entry.path || entry.filePath;
					// Create a file object for compatibility
					file = { path: filePath };
					entry.file = file;
				} else {
					console.error(`[${this.type}] No file path found, returning null`);
					return null;
				}
			}

			console.log(`[${this.type}] File path:`, file.path);

			// Extract task content from multiple sources
			const content = this.extractTaskContent(entry);
			console.log(`[${this.type}] Extracted content:`, content);
			
			// Skip entries with no meaningful task content
			if (!content || content === "") {
				console.log(`[${this.type}] Skipping entry with no task content: ${file.path}`);
				return null;
			}

			// Extract task metadata
			const metadata = this.extractTaskMetadata(entry);
			console.log(`[${this.type}] Extracted metadata:`, metadata);

			// Extract task status mark
			const status = this.extractTaskStatus(entry);
			console.log(`[${this.type}] Extracted status:`, status);

			const taskId = this.generateTaskId(entry);
			console.log(`[${this.type}] Generated task ID:`, taskId);

			// Build task object
			const task: Task = {
				id: taskId,
				content: content,
				completed: this.extractCompletionStatus(entry),
				status: status,
				filePath: file.path || "",
				line: this.getEntryProperty(entry, "line", "note") || 0,
				originalMarkdown:
					this.getEntryProperty(entry, "originalMarkdown", "note") ||
					content,
				metadata: {
					...metadata,
					children: [],
				},
			};

			console.log(`[${this.type}] Created task:`, task);
			return task;
		} catch (error) {
			console.error(
				`[${this.type}] Error converting entry to task:`,
				error,
				entry
			);
			console.error(`[${this.type}] Error stack:`, (error as Error).stack);
			return null;
		}
	}

	protected hasTasksChanged(oldTasks: Task[], newTasks: Task[]): boolean {
		if (oldTasks.length !== newTasks.length) {
			console.log(
				`[${this.type}] Task count changed: ${oldTasks.length} -> ${newTasks.length}`
			);
			return true;
		}

		// Create maps for efficient comparison
		const oldTaskMap = new Map(oldTasks.map((t) => [t.id, t]));

		for (const newTask of newTasks) {
			const oldTask = oldTaskMap.get(newTask.id);
			if (!oldTask) {
				console.log(`[${this.type}] New task detected: ${newTask.id}`);
				return true;
			}

			// Compare basic properties
			if (oldTask.content !== newTask.content) {
				console.log(
					`[${this.type}] Task content changed: ${newTask.id}`
				);
				return true;
			}

			if (oldTask.completed !== newTask.completed) {
				console.log(
					`[${this.type}] Task completion status changed: ${newTask.id}`
				);
				return true;
			}

			if (oldTask.status !== newTask.status) {
				console.log(
					`[${this.type}] Task status changed: ${newTask.id}`
				);
				return true;
			}

			// Compare metadata
			const oldMeta = oldTask.metadata;
			const newMeta = newTask.metadata;

			if (oldMeta.priority !== newMeta.priority) {
				console.log(
					`[${this.type}] Task priority changed: ${newTask.id}`
				);
				return true;
			}

			if (oldMeta.dueDate !== newMeta.dueDate) {
				console.log(
					`[${this.type}] Task due date changed: ${newTask.id}`
				);
				return true;
			}

			if (oldMeta.project !== newMeta.project) {
				console.log(
					`[${this.type}] Task project changed: ${newTask.id}`
				);
				return true;
			}

			// Compare tags array
			const oldTags = oldMeta.tags || [];
			const newTags = newMeta.tags || [];
			if (
				oldTags.length !== newTags.length ||
				!oldTags.every((tag, index) => tag === newTags[index])
			) {
				console.log(`[${this.type}] Task tags changed: ${newTask.id}`);
				return true;
			}
		}

		console.log(`[${this.type}] No significant changes detected in tasks`);
		return false;
	}

	protected refreshTasks(): void {
		// Force refresh by triggering data update flow
		console.log(`[${this.type}] Refreshing tasks`);
		this.onDataUpdated();
	}

	protected forceUpdateTasks(): void {
		// Force update without change detection
		console.log(`[${this.type}] Force updating tasks`);
		this.convertEntriesToTasks();
		this.onDataUpdated();
	}

	/**
	 * Update UI with latest task data without triggering full view refresh
	 * This is a placeholder method that subclasses can override
	 */
	protected updateUIWithLatestTaskData(): void {
		console.log(`[${this.type}] Updating UI with latest task data (base implementation)`);
		// Base implementation does nothing - subclasses should override if needed
	}

	/**
	 * Extract task content from entry using multiple sources
	 */
	private extractTaskContent(entry: any): string {
		// Try multiple content sources in priority order
		const contentSources = [
			// Check note.data first (new Bases API)
			() => entry.note?.data?.title,
			() => entry.note?.data?.content,
			() => entry.note?.data?.text,
			() => entry.note?.data?.task,
			// Then try the getEntryProperty method
			() => this.getEntryProperty(entry, "title", "note"),
			() => this.getEntryProperty(entry, "content", "note"),
			() => this.getEntryProperty(entry, "text", "note"),
			() => this.getEntryProperty(entry, "task", "note"),
			// Fall back to file name if no content found
			() => entry.file?.basename,
			() => entry.file?.name,
		];

		for (const getContent of contentSources) {
			try {
				const content = getContent();
				if (content && typeof content === "string" && content.trim()) {
					return content.trim();
				}
			} catch (error) {
				// Continue to next source
			}
		}

		// If we only have a file name and no real content, return null to skip this entry
		if (entry.file?.basename && !entry.note?.data) {
			return "";
		}

		return "Untitled Task";
	}

	/**
	 * Extract task metadata from entry
	 */
	private extractTaskMetadata(entry: any): any {
		return {
			tags: this.extractTags(entry),
			project: this.extractProject(entry),
			tgProject: this.getEntryProperty(entry, "tgProject", "note") || "",
			priority: this.extractPriority(entry),
			dueDate:
				this.extractDate(entry, "dueDate") ||
				this.extractDate(entry, "due"),
			scheduledDate:
				this.extractDate(entry, "scheduledDate") ||
				this.extractDate(entry, "scheduled"),
			startDate:
				this.extractDate(entry, "startDate") ||
				this.extractDate(entry, "start"),
			completedDate:
				this.extractDate(entry, "completedDate") ||
				this.extractDate(entry, "completed"),
			createdDate:
				this.extractDate(entry, "createdDate") ||
				this.extractDate(entry, "created") ||
				this.extractFileCreatedDate(entry),
			cancelledDate:
				this.extractDate(entry, "cancelledDate") ||
				this.extractDate(entry, "cancelled"),
			context: this.getEntryProperty(entry, "context", "note") || "",
			recurrence:
				this.getEntryProperty(entry, "recurrence", "note") || undefined,
			onCompletion:
				this.getEntryProperty(entry, "onCompletion", "note") ||
				undefined,
		};
	}

	/**
	 * Extract completion status from entry
	 */
	private extractCompletionStatus(entry: any): boolean {
		// Check multiple completion indicators
		const completionSources = [
			() => this.getEntryProperty(entry, "completed", "note"),
			() => this.getEntryProperty(entry, "done", "note"),
			() => entry.frontmatter?.completed,
			() => entry.frontmatter?.done,
		];

		for (const getCompleted of completionSources) {
			try {
				const completed = getCompleted();
				if (typeof completed === "boolean") {
					return completed;
				}
				if (typeof completed === "string") {
					return (
						completed.toLowerCase() === "true" || completed === "x"
					);
				}
			} catch (error) {
				// Continue to next source
			}
		}

		return false;
	}

	/**
	 * Extract task status mark from entry
	 */
	private extractTaskStatus(entry: any): string {
		const statusSources = [
			() => this.getEntryProperty(entry, "status", "note"),
			() => entry.frontmatter?.status,
		];

		for (const getStatus of statusSources) {
			try {
				const status = getStatus();
				if (status && typeof status === "string") {
					return status;
				}
			} catch (error) {
				// Continue to next source
			}
		}

		// Default status based on completion
		return this.extractCompletionStatus(entry) ? "x" : " ";
	}

	/**
	 * Extract tags from entry
	 */
	private extractTags(entry: any): string[] {
		const tagSources = [
			() => this.getEntryProperty(entry, "tags", "note"),
			() => entry.frontmatter?.tags,
		];

		for (const getTags of tagSources) {
			try {
				const tags = getTags();
				if (Array.isArray(tags)) {
					return tags.filter((tag) => typeof tag === "string");
				}
				if (typeof tags === "string") {
					return tags
						.split(",")
						.map((tag) => tag.trim())
						.filter((tag) => tag);
				}
			} catch (error) {
				// Continue to next source
			}
		}

		return [];
	}

	/**
	 * Extract project from entry
	 */
	private extractProject(entry: any): string {
		const projectSources = [
			// Check note.data first (new Bases API)
			() => entry.note?.data?.project,
			() => entry.note?.data?.projectName,
			() => entry.note?.data?.['tgProject'],
			// Then try standard methods
			() => this.getEntryProperty(entry, "project", "note"),
			() => this.getEntryProperty(entry, "projectName", "note"),
			() => this.getEntryProperty(entry, "tgProject", "note"),
			() => entry.frontmatter?.project,
			() => entry.frontmatter?.projectName,
			// Finally check tags
			() => this.extractProjectFromTags(entry),
		];

		for (const getProject of projectSources) {
			try {
				const project = getProject();
				if (project && typeof project === "string") {
					console.log(`[${this.type}] Found project: ${project}`);
					return project.trim();
				}
			} catch (error) {
				// Continue to next source
			}
		}

		return "";
	}

	/**
	 * Extract project from tags
	 */
	private extractProjectFromTags(entry: any): string {
		const tags = this.extractTags(entry);
		const projectTag = tags.find(
			(tag) =>
				tag.startsWith("#project/") ||
				tag.startsWith("project/") ||
				tag.startsWith("#proj/") ||
				tag.startsWith("proj/")
		);

		if (projectTag) {
			return projectTag.replace(/^#?(project|proj)\//, "");
		}

		return "";
	}

	/**
	 * Extract priority from entry
	 */
	private extractPriority(entry: any): number {
		const prioritySources = [
			() => this.getEntryProperty(entry, "priority", "note"),
			() => entry.frontmatter?.priority,
		];

		for (const getPriority of prioritySources) {
			try {
				const priority = getPriority();
				if (typeof priority === "number") {
					return Math.max(0, Math.min(10, priority));
				}
				if (typeof priority === "string") {
					const parsed = parseInt(priority);
					if (!isNaN(parsed)) {
						return Math.max(0, Math.min(10, parsed));
					}
				}
			} catch (error) {
				// Continue to next source
			}
		}

		return 0;
	}

	/**
	 * Extract date from entry
	 */
	private extractDate(entry: any, dateField: string): number | undefined {
		const dateSources = [
			() => this.getEntryProperty(entry, dateField, "note"),
			() => entry.frontmatter?.[dateField],
		];

		for (const getDate of dateSources) {
			try {
				const date = getDate();
				if (typeof date === "number") {
					return date;
				}
				if (typeof date === "string") {
					const parsed = Date.parse(date);
					if (!isNaN(parsed)) {
						return parsed;
					}
				}
				if (date instanceof Date) {
					return date.getTime();
				}
			} catch (error) {
				// Continue to next source
			}
		}

		return undefined;
	}

	/**
	 * Extract file created date
	 */
	private extractFileCreatedDate(entry: any): number | undefined {
		try {
			const file = entry.file;
			if (file?.stat?.ctime) {
				return file.stat.ctime;
			}
		} catch (error) {
			// Ignore error
		}
		return undefined;
	}

	/**
	 * Generate unique task ID from entry
	 */
	private generateTaskId(entry: any): string {
		try {
			const file = entry.file;
			if (file?.path) {
				return file.path;
			}
		} catch (error) {
			// Fallback to random ID
		}

		return `task-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
	}

	/**
	 * Generic property accessor for Bases entries
	 */
	private getEntryProperty(
		entry: any,
		propertyName: string,
		type: "note" | "file" | "formula" = "note"
	): any {
		// Only log important properties
		const shouldLog = ["title", "content", "text", "completed", "status"].includes(propertyName);
		if (shouldLog) {
			console.log(`[${this.type}] Getting property '${propertyName}' of type '${type}' from entry`);
		}
		
		try {
			if (typeof entry.getValue === "function") {
				const value = entry.getValue({ type, name: propertyName });
				if (shouldLog && value !== undefined) {
					console.log(`[${this.type}] Got value from getValue function:`, value);
				}
				return value;
			}
		} catch (error) {
			// Fallback to direct access
		}

		// Fallback: try direct property access
		try {
			if (type === "note") {
				// Try note.data structure (new Bases API)
				if (entry.note?.data && entry.note.data[propertyName] !== undefined) {
					if (shouldLog) {
						console.log(`[${this.type}] Got value from note.data:`, entry.note.data[propertyName]);
					}
					return entry.note.data[propertyName];
				}
				// Try frontmatter
				if (entry.frontmatter && entry.frontmatter[propertyName] !== undefined) {
					if (shouldLog) {
						console.log(`[${this.type}] Got value from frontmatter:`, entry.frontmatter[propertyName]);
					}
					return entry.frontmatter[propertyName];
				}
				// Try direct property on entry
				if (entry[propertyName] !== undefined) {
					if (shouldLog) {
						console.log(`[${this.type}] Got value from direct property:`, entry[propertyName]);
					}
					return entry[propertyName];
				}
			}
			if (type === "file" && entry.file) {
				const value = entry.file[propertyName];
				if (value !== undefined && shouldLog) {
					console.log(`[${this.type}] Got value from file:`, value);
				}
				return value;
			}
		} catch (error) {
			// Ignore error
		}

		if (shouldLog) {
			console.log(`[${this.type}] Property '${propertyName}' not found`);
		}
		return undefined;
	}

	// Abstract methods that subclasses must implement
	protected abstract onConfigUpdated(): void;
	protected abstract onDataUpdated(): void;
	protected abstract onDisplay(): void;
	protected abstract onViewLoad(): void;
	protected abstract onViewUnload(): void;
	protected abstract onViewResize(): void;
	protected abstract getCustomActions(): Array<{
		name: string;
		callback: () => void;
		icon: string;
	}>;
	protected abstract getEditMenuItems(): Array<{
		displayName: string;
		component: (container: HTMLElement) => any;
	}>;

	// Utility methods for subclasses
	protected createErrorContainer(message: string): HTMLElement {
		const errorEl = this.containerEl.createDiv({
			cls: "bases-view-error",
		});

		errorEl.createDiv({
			cls: "bases-view-error-icon",
			text: "⚠️",
		});

		errorEl.createDiv({
			cls: "bases-view-error-message",
			text: message,
		});

		return errorEl;
	}

	protected createLoadingContainer(): HTMLElement {
		const loadingEl = this.containerEl.createDiv({
			cls: "bases-view-loading",
		});

		loadingEl.createDiv({
			cls: "bases-view-loading-spinner",
		});

		loadingEl.createDiv({
			cls: "bases-view-loading-text",
			text: "Loading tasks...",
		});

		return loadingEl;
	}

	protected createEmptyContainer(
		message: string = "No tasks found"
	): HTMLElement {
		const emptyEl = this.containerEl.createDiv({
			cls: "bases-view-empty",
		});

		emptyEl.createDiv({
			cls: "bases-view-empty-icon",
			text: "📋",
		});

		emptyEl.createDiv({
			cls: "bases-view-empty-message",
			text: message,
		});

		return emptyEl;
	}

	/**
	 * Debug method to test Bases API availability
	 */
	private debugBasesApiAvailability(entry: any): void {
		console.log(`[${this.type}] Debugging Bases API for entry:`, entry);

		const availableMethods = Object.keys(entry).filter(
			(key) => typeof entry[key] === "function"
		);
		console.log(`[${this.type}] Available methods:`, availableMethods);

		// Check for common Bases methods
		const expectedMethods = ["updateProperty", "setValue", "getValue"];
		for (const method of expectedMethods) {
			const available = typeof entry[method] === "function";
			console.log(`[${this.type}] ${method}: ${available ? "✓" : "✗"}`);
		}

		// Check entry structure
		console.log(`[${this.type}] Entry keys:`, Object.keys(entry));
		if (entry.file) {
			console.log(`[${this.type}] Entry file:`, entry.file);
		}
		if (entry.frontmatter) {
			console.log(`[${this.type}] Entry frontmatter:`, entry.frontmatter);
		}
	}
}
