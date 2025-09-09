/**
 * WriteAPI - Handles all write operations in the Dataflow architecture
 *
 * This API provides methods for creating, updating, and deleting tasks
 * by directly modifying vault files. Changes trigger ObsidianSource events
 * which automatically update the index through the Orchestrator.
 */

import { App, TFile, Vault, MetadataCache, moment } from "obsidian";
import { Task, CanvasTaskMetadata } from "../../types/task";
import TaskProgressBarPlugin from "../../index";
import {
	createDailyNote,
	getAllDailyNotes,
	getDailyNote,
	appHasDailyNotesPluginLoaded,
	getDailyNoteSettings,
} from "obsidian-daily-notes-interface";
import {
	saveCapture,
	processDateTemplates,
} from "@/utils/file/file-operations";
import { Events, emit } from "../events/Events";
import { CanvasTaskUpdater } from "../../parsers/canvas-task-updater";

/**
 * Arguments for creating a task
 */
export interface CreateTaskArgs {
	content: string;
	filePath?: string;
	parent?: string;
	tags?: string[];
	project?: string;
	context?: string;
	priority?: number;
	startDate?: string;
	dueDate?: string;
	completed?: boolean;
	completedDate?: string;
}

/**
 * Arguments for updating a task
 */
export interface UpdateTaskArgs {
	taskId: string;
	updates: Partial<Task>;
}

/**
 * Arguments for deleting a task
 */
export interface DeleteTaskArgs {
	taskId: string;
	deleteChildren?: boolean;
}

/**
 * Arguments for batch text update
 */
export interface BatchUpdateTextArgs {
	taskIds: string[];
	findText: string;
	replaceText: string;
}

/**
 * Arguments for batch subtask creation
 */
export interface BatchCreateSubtasksArgs {
	parentTaskId: string;
	subtasks: Array<{
		content: string;
		priority?: number;
		dueDate?: string;
	}>;
}

export class WriteAPI {
	private canvasTaskUpdater: CanvasTaskUpdater;

	constructor(
		private app: App,
		private vault: Vault,
		private metadataCache: MetadataCache,
		private plugin: TaskProgressBarPlugin,
		private getTaskById: (id: string) => Promise<Task | null> | Task | null
	) {
		this.canvasTaskUpdater = new CanvasTaskUpdater(vault, plugin);
	}

	/**
	 * Update a task's status or completion state
	 */
	async updateTaskStatus(args: {
		taskId: string;
		status?: string;
		completed?: boolean;
	}): Promise<{ success: boolean; task?: Task; error?: string }> {
		try {
			const task = await Promise.resolve(this.getTaskById(args.taskId));
			if (!task) {
				return {success: false, error: "Task not found"};
			}

			// Check if this is a Canvas task
			if (CanvasTaskUpdater.isCanvasTask(task)) {
				return this.updateCanvasTask({
					taskId: args.taskId,
					updates: {
						status: args.status,
						completed: args.completed,
					},
				});
			}

			const file = this.vault.getAbstractFileByPath(
				task.filePath
			) as TFile;
			if (!file) {
				return {success: false, error: "File not found"};
			}

			const content = await this.vault.read(file);
			const lines = content.split("\n");

			if (task.line < 0 || task.line >= lines.length) {
				return {success: false, error: "Invalid line number"};
			}

			let taskLine = lines[task.line];

			// Update status or completion
			if (args.status !== undefined) {
				taskLine = taskLine.replace(
					/(\s*[-*+]\s*\[)[^\]]*(\]\s*)/,
					`$1${args.status}$2`
				);
			} else if (args.completed !== undefined) {
				const statusMark = args.completed ? "x" : " ";
				taskLine = taskLine.replace(
					/(\s*[-*+]\s*\[)[^\]]*(\]\s*)/,
					`$1${statusMark}$2`
				);

				// Add completion date if completing
				if (args.completed && !task.metadata.completedDate) {
					const completionDate = moment().format("YYYY-MM-DD");
					const useDataviewFormat =
						this.plugin.settings.preferMetadataFormat ===
						"dataview";
					const completionMeta = useDataviewFormat
						? `[completion:: ${completionDate}]`
						: `✅ ${completionDate}`;
					taskLine = `${taskLine} ${completionMeta}`;
				}
			}

			lines[task.line] = taskLine;

			// Notify about write operation
			emit(this.app, Events.WRITE_OPERATION_START, {
				path: file.path,
				taskId: args.taskId,
			});
			await this.vault.modify(file, lines.join("\n"));
			emit(this.app, Events.WRITE_OPERATION_COMPLETE, {
				path: file.path,
				taskId: args.taskId,
			});

			// Trigger task-completed event if task was just completed
			if (args.completed === true && !task.completed) {
				const updatedTask = {...task, completed: true};
				this.app.workspace.trigger(
					"task-genius:task-completed",
					updatedTask
				);
			}

			return {success: true};
		} catch (error) {
			console.error("WriteAPI: Error updating task status:", error);
			return {success: false, error: String(error)};
		}
	}

	/**
	 * Update a task with new properties
	 */
	async updateTask(
		args: UpdateTaskArgs
	): Promise<{ success: boolean; task?: Task; error?: string }> {
		try {
			const originalTask = await Promise.resolve(
				this.getTaskById(args.taskId)
			);
			if (!originalTask) {
				return {success: false, error: "Task not found"};
			}

			// Check if this is a Canvas task
			if (CanvasTaskUpdater.isCanvasTask(originalTask)) {
				return this.updateCanvasTask(args);
			}

			// Handle FileSource (file-level) tasks differently
			const isFileSourceTask =
				(originalTask as any)?.metadata?.source === "file-source" ||
				originalTask.id.startsWith("file-source:");
			if (isFileSourceTask) {
				return this.updateFileSourceTask(
					originalTask,
					args.updates,
					args.taskId
				);
			}

			const file = this.vault.getAbstractFileByPath(
				originalTask.filePath
			) as TFile;
			if (!file) {
				return {success: false, error: "File not found"};
			}

			const content = await this.vault.read(file);
			const lines = content.split("\n");

			if (originalTask.line < 0 || originalTask.line >= lines.length) {
				return {success: false, error: "Invalid line number"};
			}

			const updatedTask = {...originalTask, ...args.updates};
			let taskLine = lines[originalTask.line];

			// Update checkbox status or status mark
			if (args.updates.status !== undefined) {
				// Prefer explicit status mark if provided
				const statusMark = args.updates.status as string;
				taskLine = taskLine.replace(
					/(\s*[-*+]\s*\[)[^\]]*(\]\s*)/,
					`$1${statusMark}$2`
				);
			} else if (args.updates.completed !== undefined) {
				// Fallback to setting based on completed boolean
				const statusMark = args.updates.completed ? "x" : " ";
				taskLine = taskLine.replace(
					/(\s*[-*+]\s*\[)[^\]]*(\]\s*)/,
					`$1${statusMark}$2`
				);
			}

			// Update content if changed
			if (args.updates.content !== undefined) {
				// Extract the task prefix and metadata
				const prefixMatch = taskLine.match(
					/^(\s*[-*+]\s*\[[^\]]*\]\s*)/
				);
				if (prefixMatch) {
					const prefix = prefixMatch[1];
					// Find where metadata starts (look for emoji markers or dataview fields)
					const metadataMatch = taskLine.match(
						/([\s]+(🔺|⏫|🔼|🔽|⏬|🛫|⏳|📅|✅|🔁|\[[\w]+::|#|@|\+).*)?$/
					);
					const metadata = metadataMatch ? metadataMatch[0] : "";
					taskLine = `${prefix}${args.updates.content}${metadata}`;
				}
			}

			// Update metadata if changed
			if (args.updates.metadata) {
				// Remove existing metadata and regenerate
				const prefixMatch = taskLine.match(
					/^(\s*[-*+]\s*\[[^\]]*\]\s*[^🔺⏫🔼🔽⏬🛫⏳📅✅🔁\[#@+]*)/
				);
				if (prefixMatch) {
					const taskPrefix = prefixMatch[0];
					const newMetadata = this.generateMetadata({
						...originalTask.metadata,
						...args.updates.metadata,
					});
					taskLine = `${taskPrefix}${
						newMetadata ? ` ${newMetadata}` : ""
					}`;
				}
			}

			lines[originalTask.line] = taskLine;

			// Notify about write operation
			emit(this.app, Events.WRITE_OPERATION_START, {
				path: file.path,
				taskId: args.taskId,
			});
			await this.vault.modify(file, lines.join("\n"));

			// Create the updated task object with the new content
			const updatedTaskObj: Task = {
				...originalTask,
				...args.updates,
				originalMarkdown: taskLine.replace(
					/^\s*[-*+]\s*\[[^\]]*\]\s*/,
					""
				), // Remove checkbox prefix
			};

			// Emit task updated event for direct update in dataflow
			emit(this.app, Events.TASK_UPDATED, {task: updatedTaskObj});

			// Trigger task-completed event if task was just completed
			if (args.updates.completed === true && !originalTask.completed) {
				this.app.workspace.trigger(
					"task-genius:task-completed",
					updatedTaskObj
				);
			}

			// Still emit write operation complete for compatibility
			emit(this.app, Events.WRITE_OPERATION_COMPLETE, {
				path: file.path,
				taskId: args.taskId,
			});

			return {success: true, task: updatedTaskObj};
		} catch (error) {
			console.error("WriteAPI: Error updating task:", error);
			return {success: false, error: String(error)};
		}
	}

	/**
	 * Update a FileSource (file-level) task. This updates frontmatter title, H1, or filename
	 * depending on settings, instead of trying to edit a markdown checkbox line.
	 */
	private async updateFileSourceTask(
		originalTask: Task,
		updates: Partial<Task>,
		taskId: string
	): Promise<{ success: boolean; task?: Task; error?: string }> {
		const file = this.vault.getAbstractFileByPath(
			originalTask.filePath
		) as TFile;
		if (!file) {
			return {success: false, error: "File not found"};
		}

		let newFilePath = originalTask.filePath;
		const cfg = this.plugin.settings?.fileSource?.fileTaskProperties;
		const contentSource: "filename" | "title" | "h1" | "custom" =
			cfg?.contentSource ?? "filename";
		const preferFrontmatterTitle = cfg?.preferFrontmatterTitle ?? true;
		const customContentField = (
			this.plugin.settings?.fileSource?.fileTaskProperties as any
		)?.customContentField as string | undefined;

		// Apply frontmatter updates for non-content fields (status, completed, metadata)
		try {
			const md = (updates.metadata ?? {}) as any;
			const hasFrontmatterUpdates =
				updates.status !== undefined ||
				updates.completed !== undefined ||
				md.priority !== undefined ||
				md.tags !== undefined ||
				md.project !== undefined ||
				md.context !== undefined ||
				md.area !== undefined ||
				md.dueDate !== undefined ||
				md.startDate !== undefined ||
				md.scheduledDate !== undefined;

			if (hasFrontmatterUpdates) {
				// Announce start of a write operation for frontmatter updates
				emit(this.app, Events.WRITE_OPERATION_START, {
					path: file.path,
					taskId,
				});

				const formatDate = (val: any): any => {
					if (val === undefined || val === null) return val;
					if (typeof val === "number") {
						// Write as YYYY-MM-DD for frontmatter consistency
						return new Date(val).toISOString().split("T")[0];
					}
					if (val instanceof Date) {
						return val.toISOString().split("T")[0];
					}
					return val; // assume already a string
				};

				await this.app.fileManager.processFrontMatter(file, (fm) => {
					// Top-level status/completed
					if (updates.status !== undefined) {
						// If status mapping is enabled, prefer writing human-readable metadata value;
						// otherwise write the raw symbol.
						const fsMapping =
							this.plugin.settings?.fileSource?.statusMapping;
						let statusToWrite: string = updates.status as any;
						if (fsMapping?.enabled) {
							// Try explicit symbol->metadata mapping first
							const mapped =
								fsMapping.symbolToMetadata?.[statusToWrite];
							if (mapped) {
								statusToWrite = mapped;
							} else {
								console.log(
									"[WriteAPI][FileSource] fallback mapping from taskStatuses",
									this.plugin.settings?.taskStatuses
								);
								// Derive from Task Status settings as a fallback
								const taskStatuses = (this.plugin.settings
									?.taskStatuses || {}) as Record<
									string,
									string
								>;
								const listByType = Object.entries(
									taskStatuses
								).map(([type, symbols]) => ({
									type,
									symbols: String(symbols),
								}));
								for (const entry of listByType) {
									const parts = entry.symbols
										.split("|")
										.filter(Boolean);
									for (const sym of parts) {
										if (
											sym === statusToWrite ||
											(sym.length > 1 &&
												sym.includes(statusToWrite))
										) {
											// Map types to canonical metadata values
											const typeToMetadata: Record<
												string,
												string
											> = {
												completed: "completed",
												inProgress: "in-progress",
												planned: "planned",
												abandoned: "cancelled",
												notStarted: "not-started",
											};
											const md =
												typeToMetadata[entry.type];
											if (md) {
												statusToWrite = md;
											}
											break;
										}
									}
									if (
										statusToWrite !==
										(updates.status as any)
									)
										break;
								}
							}
						}
						(fm as any).status = statusToWrite;
					}
					if (updates.completed !== undefined) {
						(fm as any).completed = updates.completed;
					}

					// Metadata fields
					if (md.priority !== undefined) {
						(fm as any).priority = md.priority;
						console.log(
							"[WriteAPI][FileSource] wrote fm.priority",
							{priority: md.priority}
						);
					}
					if (
						md.tags !== undefined &&
						Array.isArray(md.tags) &&
						md.tags.length > 0
					) {
						(fm as any).tags = Array.isArray(md.tags)
							? md.tags
							: typeof md.tags === "string"
								? [md.tags]
								: md.tags;
					}
					if (md.project !== undefined) {
						(fm as any).project = md.project;
					}
					if (md.context !== undefined) {
						(fm as any).context = md.context;
					}
					if (md.area !== undefined) {
						(fm as any).area = md.area;
						console.log("[WriteAPI][FileSource] wrote fm.area", {
							area: md.area,
						});
					}
					if (md.dueDate !== undefined) {
						(fm as any).dueDate = formatDate(md.dueDate);
						console.log("[WriteAPI][FileSource] wrote fm.dueDate", {
							dueDate: (fm as any).dueDate,
						});
					}
					if (md.startDate !== undefined) {
						(fm as any).startDate = formatDate(md.startDate);
						console.log(
							"[WriteAPI。][FileSource] wrote fm.startDate",
							{startDate: (fm as any).startDate}
						);
					}
					if (md.scheduledDate !== undefined) {
						(fm as any).scheduledDate = formatDate(
							md.scheduledDate
						);
						console.log(
							"[WriteAPI][FileSource] wrote fm.scheduledDate",
							{scheduledDate: (fm as any).scheduledDate}
						);
					}
				});

				// Announce completion of frontmatter write operation
				emit(this.app, Events.WRITE_OPERATION_COMPLETE, {
					path: file.path,
					taskId,
				});
			}
		} catch (error) {
			console.error(
				"WriteAPI: Error updating file-source task frontmatter:",
				error
			);
			return {success: false, error: String(error)};
		}

		// Handle content/title change
		const shouldWriteContent = typeof updates.content === "string";
		console.log("[WriteAPI][FileSource] content change gate", {
			originalContent: originalTask.content,
			updatesContent: updates.content,
			shouldWriteContent,
		});
		if (shouldWriteContent) {
			try {
				// Announce start of a write operation
				emit(this.app, Events.WRITE_OPERATION_START, {
					path: file.path,
					taskId,
				});

				console.log("[WriteAPI][FileSource] content branch", {
					contentSource,
					preferFrontmatterTitle,
					customContentField,
				});
				switch (contentSource) {
					case "title": {
						if (preferFrontmatterTitle) {
							await this.app.fileManager.processFrontMatter(
								file,
								(fm) => {
									(fm as any).title = updates.content;
								}
							);
							console.log(
								"[WriteAPI][FileSource] wrote fm.title (branch: title)",
								{title: updates.content}
							);
							const cacheAfter =
								this.app.metadataCache.getFileCache(file);
							console.log(
								"[WriteAPI][FileSource] cache fm.title after write (branch: title)",
								{title: cacheAfter?.frontmatter?.title}
							);
						} else {
							newFilePath = await this.renameFile(
								file,
								updates.content!
							);
							console.log(
								"[WriteAPI][FileSource] renamed file (branch: title)",
								{newFilePath}
							);
						}
						break;
					}
					case "h1": {
						await this.updateH1Heading(file, updates.content!);
						break;
					}
					case "custom": {
						if (customContentField) {
							await this.app.fileManager.processFrontMatter(
								file,
								(fm) => {
									(fm as any)[customContentField] =
										updates.content;
								}
							);
							console.log(
								"[WriteAPI][FileSource] wrote fm[customContentField] (branch: custom)",
								{
									field: customContentField,
									value: updates.content,
								}
							);
							const cacheAfter =
								this.app.metadataCache.getFileCache(file);
							console.log(
								"[WriteAPI][FileSource] cache fm[customContentField] after write (branch: custom)",
								{
									field: customContentField,
									value: cacheAfter?.frontmatter?.[
										customContentField
										],
								}
							);
						} else if (preferFrontmatterTitle) {
							await this.app.fileManager.processFrontMatter(
								file,
								(fm) => {
									(fm as any).title = updates.content;
								}
							);
							console.log(
								"[WriteAPI][FileSource] wrote fm.title (branch: custom fallback)",
								{title: updates.content}
							);
							const cacheAfter2 =
								this.app.metadataCache.getFileCache(file);
							console.log(
								"[WriteAPI][FileSource] cache fm.title after write (branch: custom fallback)",
								{title: cacheAfter2?.frontmatter?.title}
							);
						} else {
							newFilePath = await this.renameFile(
								file,
								updates.content!
							);
							console.log(
								"[WriteAPI][FileSource] renamed file (branch: custom fallback)",
								{newFilePath}
							);
						}
						break;
					}
					case "filename":
					default: {
						if (preferFrontmatterTitle) {
							await this.app.fileManager.processFrontMatter(
								file,
								(fm) => {
									(fm as any).title = updates.content;
								}
							);
							console.log(
								"[WriteAPI][FileSource] wrote fm.title (branch: filename/default)",
								{title: updates.content}
							);
							const cacheAfter =
								this.app.metadataCache.getFileCache(file);
							console.log(
								"[WriteAPI][FileSource] cache fm.title after write (branch: filename/default)",
								{title: cacheAfter?.frontmatter?.title}
							);
						} else {
							newFilePath = await this.renameFile(
								file,
								updates.content!
							);
							console.log(
								"[WriteAPI][FileSource] renamed file (branch: filename/default)",
								{newFilePath}
							);
						}
						break;
					}
				}

				// Announce completion of write operation
				emit(this.app, Events.WRITE_OPERATION_COMPLETE, {
					path: newFilePath,
					taskId,
				});
			} catch (error) {
				console.error(
					"WriteAPI: Error updating file-source task content:",
					error
				);
				return {success: false, error: String(error)};
			}
		}

		// Build the updated task object
		const updatedTaskObj: Task = {
			...originalTask,
			...updates,
			filePath: newFilePath,
			// Keep id in sync with FileSource convention when path changes
			id:
				originalTask.id.startsWith("file-source:") &&
				newFilePath !== originalTask.filePath
					? `file-source:${newFilePath}`
					: originalTask.id,
			originalMarkdown: `[${
				updates.content ?? originalTask.content
			}](${newFilePath})`,
		};

		// Emit file-task update so repository updates fileTasks map directly
		emit(this.app, Events.FILE_TASK_UPDATED, {task: updatedTaskObj});

		return {success: true, task: updatedTaskObj};
	}

	private async updateH1Heading(
		file: TFile,
		newHeading: string
	): Promise<void> {
		const content = await this.vault.read(file);
		const lines = content.split("\n");
		// Find first H1 after optional frontmatter
		let h1Index = -1;
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].startsWith("# ")) {
				h1Index = i;
				break;
			}
		}
		if (h1Index >= 0) {
			lines[h1Index] = `# ${newHeading}`;
		} else {
			let insertIndex = 0;
			if (content.startsWith("---")) {
				const fmEnd = content.indexOf("\n---\n", 3);
				if (fmEnd >= 0) {
					const fmLines =
						content.substring(0, fmEnd + 5).split("\n").length - 1;
					insertIndex = fmLines;
				}
			}
			lines.splice(insertIndex, 0, `# ${newHeading}`, "");
		}
		await this.vault.modify(file, lines.join("\n"));
	}

	private async renameFile(file: TFile, newTitle: string): Promise<string> {
		const currentPath = file.path;
		const lastSlash = currentPath.lastIndexOf("/");
		const directory =
			lastSlash > 0 ? currentPath.substring(0, lastSlash) : "";
		const extension = currentPath.substring(currentPath.lastIndexOf("."));
		const sanitized = this.sanitizeFileName(newTitle);
		const newPath = directory
			? `${directory}/${sanitized}${extension}`
			: `${sanitized}${extension}`;
		if (newPath !== currentPath) {
			await this.vault.rename(file, newPath);
		}
		return newPath;
	}

	private sanitizeFileName(name: string): string {
		return name.replace(/[<>:"/\\|?*]/g, "_");
	}

	/**
	 * Create a new task
	 */
	async createTask(
		args: CreateTaskArgs
	): Promise<{ success: boolean; task?: Task; error?: string }> {
		try {
			let filePath = args.filePath;

			if (!filePath) {
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile) {
					filePath = activeFile.path;
				} else {
					return {
						success: false,
						error: "No filePath provided and no active file",
					};
				}
			}

			// Build task content
			const checkboxState = args.completed ? "[x]" : "[ ]";
			let taskContent = `- ${checkboxState} ${args.content}`;
			const metadata = this.generateMetadata({
				tags: args.tags,
				project: args.project,
				context: args.context,
				priority: args.priority,
				startDate: args.startDate
					? moment(args.startDate).valueOf()
					: undefined,
				dueDate: args.dueDate
					? moment(args.dueDate).valueOf()
					: undefined,
				completed: args.completed,
				completedDate: args.completedDate
					? moment(args.completedDate).valueOf()
					: undefined,
			});
			if (metadata) {
				taskContent += ` ${metadata}`;
			}

			// Ensure file exists
			let file = this.vault.getAbstractFileByPath(
				filePath
			) as TFile | null;
			if (!file) {
				// Create directory structure if needed
				const parts = filePath.split("/");
				if (parts.length > 1) {
					const dir = parts.slice(0, -1).join("/");
					try {
						await this.vault.createFolder(dir);
					} catch {
						// Ignore if exists
					}
				}
				// Create file
				file = await this.vault.create(filePath, `${taskContent}\n`);
			} else {
				// Append to existing file or insert as subtask
				const content = await this.vault.read(file);
				const newContent = args.parent
					? this.insertSubtask(content, args.parent, taskContent)
					: (content ? content + "\n" : "") + taskContent;

				// Notify about write operation
				emit(this.app, Events.WRITE_OPERATION_START, {
					path: file.path,
				});
				await this.vault.modify(file, newContent);
				emit(this.app, Events.WRITE_OPERATION_COMPLETE, {
					path: file.path,
				});
			}

			return {success: true};
		} catch (error) {
			console.error("WriteAPI: Error creating task:", error);
			return {success: false, error: String(error)};
		}
	}

	/**
	 * Get all descendant task IDs (children, grandchildren, etc.)
	 */
	private async getDescendantTaskIds(taskId: string): Promise<string[]> {
		const descendants: string[] = [];
		const toProcess: string[] = [taskId];
		const processed = new Set<string>();

		while (toProcess.length > 0) {
			const currentId = toProcess.pop()!;
			if (processed.has(currentId)) continue;
			processed.add(currentId);

			const task = await Promise.resolve(this.getTaskById(currentId));
			if (!task || !task.metadata) continue;

			const children = task.metadata.children || [];
			for (const childId of children) {
				if (!processed.has(childId)) {
					descendants.push(childId);
					toProcess.push(childId);
				}
			}
		}

		return descendants;
	}

	/**
	 * Delete a task
	 */
	async deleteTask(
		args: DeleteTaskArgs
	): Promise<{ success: boolean; error?: string }> {
		try {
			const task = await Promise.resolve(this.getTaskById(args.taskId));
			if (!task) {
				return {success: false, error: "Task not found"};
			}

			// Check if this is a Canvas task
			if (CanvasTaskUpdater.isCanvasTask(task)) {
				return this.deleteCanvasTask(args);
			}

			const file = this.vault.getAbstractFileByPath(
				task.filePath
			) as TFile;
			if (!file) {
				return {success: false, error: "File not found"};
			}

			// Collect all tasks to delete
			const deletedTaskIds: string[] = [args.taskId];
			const linesToDelete: number[] = [task.line];

			if (args.deleteChildren) {
				// Get all descendant tasks
				const descendantIds = await this.getDescendantTaskIds(
					args.taskId
				);
				deletedTaskIds.push(...descendantIds);

				// Collect line numbers for all descendants in the same file
				for (const descendantId of descendantIds) {
					const descendantTask = await Promise.resolve(
						this.getTaskById(descendantId)
					);
					if (
						descendantTask &&
						descendantTask.filePath === task.filePath
					) {
						linesToDelete.push(descendantTask.line);
					}
				}
			}

			// Sort lines in descending order to delete from bottom to top
			linesToDelete.sort((a, b) => b - a);

			const content = await this.vault.read(file);
			const lines = content.split("\n");

			// Delete all lines
			for (const lineNum of linesToDelete) {
				if (lineNum >= 0 && lineNum < lines.length) {
					lines.splice(lineNum, 1);
				}
			}

			// Notify about write operation
			emit(this.app, Events.WRITE_OPERATION_START, {
				path: file.path,
				taskId: args.taskId,
			});
			await this.vault.modify(file, lines.join("\n"));
			emit(this.app, Events.WRITE_OPERATION_COMPLETE, {
				path: file.path,
				taskId: args.taskId,
			});

			// Emit TASK_DELETED event with all deleted task IDs
			emit(this.app, Events.TASK_DELETED, {
				taskId: args.taskId,
				filePath: file.path,
				deletedTaskIds,
				mode: args.deleteChildren ? "subtree" : "single",
			});

			return {success: true};
		} catch (error) {
			console.error("WriteAPI: Error deleting task:", error);
			return {success: false, error: String(error)};
		}
	}

	/**
	 * Batch update task statuses
	 */
	async batchUpdateTaskStatus(args: {
		taskIds: string[];
		status?: string;
		completed?: boolean;
	}): Promise<{
		updated: string[];
		failed: Array<{ id: string; error: string }>;
	}> {
		const updated: string[] = [];
		const failed: Array<{ id: string; error: string }> = [];

		for (const taskId of args.taskIds) {
			const result = await this.updateTaskStatus({
				taskId,
				status: args.status,
				completed: args.completed,
			});

			if (result.success) {
				updated.push(taskId);
			} else {
				failed.push({
					id: taskId,
					error: result.error || "Unknown error",
				});
			}
		}

		return {updated, failed};
	}

	/**
	 * Postpone tasks to a new date
	 */
	async postponeTasks(args: { taskIds: string[]; newDate: string }): Promise<{
		updated: string[];
		failed: Array<{ id: string; error: string }>;
	}> {
		const updated: string[] = [];
		const failed: Array<{ id: string; error: string }> = [];

		const newDateMs = this.parseDateOrOffset(args.newDate);
		if (newDateMs === null) {
			return {
				updated: [],
				failed: args.taskIds.map((id) => ({
					id,
					error: "Invalid date format",
				})),
			};
		}

		for (const taskId of args.taskIds) {
			const result = await this.updateTask({
				taskId,
				updates: {
					metadata: {
						dueDate: newDateMs,
					} as any,
				},
			});

			if (result.success) {
				updated.push(taskId);
			} else {
				failed.push({
					id: taskId,
					error: result.error || "Unknown error",
				});
			}
		}

		return {updated, failed};
	}

	/**
	 * Batch update text in tasks
	 */
	async batchUpdateText(
		args: BatchUpdateTextArgs
	): Promise<{ tasks: Task[] }> {
		const updatedTasks: Task[] = [];

		for (const taskId of args.taskIds) {
			const task = await Promise.resolve(this.getTaskById(taskId));
			if (!task) continue;

			const newContent = task.content.replace(
				args.findText,
				args.replaceText
			);
			const result = await this.updateTask({
				taskId,
				updates: {content: newContent},
			});

			if (result.success) {
				const updatedTask = await Promise.resolve(
					this.getTaskById(taskId)
				);
				if (updatedTask) {
					updatedTasks.push(updatedTask);
				}
			}
		}

		return {tasks: updatedTasks};
	}

	/**
	 * Batch create subtasks
	 */
	async batchCreateSubtasks(
		args: BatchCreateSubtasksArgs
	): Promise<{ tasks: Task[] }> {
		const parentTask = await Promise.resolve(
			this.getTaskById(args.parentTaskId)
		);
		if (!parentTask) {
			return {tasks: []};
		}

		const createdTasks: Task[] = [];

		for (const subtaskData of args.subtasks) {
			const result = await this.createTask({
				...subtaskData,
				parent: args.parentTaskId,
				filePath: parentTask.filePath,
			});

			if (result.success && result.task) {
				createdTasks.push(result.task);
			}
		}

		return {tasks: createdTasks};
	}

	/**
	 * Create a task in today's daily note
	 */
	async createTaskInDailyNote(
		args: CreateTaskArgs & { heading?: string }
	): Promise<{ success: boolean; task?: Task; error?: string }> {
		try {
			// Try using Daily Notes plugin if available
			let dailyNoteFile: TFile | null = null;

			if (appHasDailyNotesPluginLoaded()) {
				const date = moment().set("hour", 12);
				const existing = getDailyNote(date, getAllDailyNotes());
				if (existing) {
					dailyNoteFile = existing;
				} else {
					dailyNoteFile = await createDailyNote(date);
				}
			}

			if (!dailyNoteFile) {
				// Fallback: compute path manually
				const qc = this.plugin.settings.quickCapture;
				let folder = qc?.dailyNoteSettings?.folder || "";
				const format = qc?.dailyNoteSettings?.format || "YYYY-MM-DD";
				if (!folder) {
					try {
						folder = getDailyNoteSettings().folder || "";
					} catch {
						// Ignore
					}
				}
				const dateStr = moment().format(format);
				const path = folder
					? `${folder}/${dateStr}.md`
					: `${dateStr}.md`;

				// Ensure folders
				const parts = path.split("/");
				if (parts.length > 1) {
					const dir = parts.slice(0, -1).join("/");
					try {
						await this.vault.createFolder(dir);
					} catch {
						// Ignore if exists
					}
				}

				// Create file if not exists
				let file = this.vault.getAbstractFileByPath(
					path
				) as TFile | null;
				if (!file) {
					file = await this.vault.create(path, "");
				}
				dailyNoteFile = file;
			}

			// Build task content
			const checkboxState = args.completed ? "[x]" : "[ ]";
			let taskContent = `- ${checkboxState} ${args.content}`;
			const metadata = this.generateMetadata({
				tags: args.tags,
				project: args.project,
				context: args.context,
				priority: args.priority,
				startDate: args.startDate
					? moment(args.startDate).valueOf()
					: undefined,
				dueDate: args.dueDate
					? moment(args.dueDate).valueOf()
					: undefined,
				completed: args.completed,
				completedDate: args.completedDate
					? moment(args.completedDate).valueOf()
					: undefined,
			});
			if (metadata) {
				taskContent += ` ${metadata}`;
			}

			// Append under optional heading
			const file = dailyNoteFile;
			const current = await this.vault.read(file);
			let newContent = current;

			if (args.parent) {
				newContent = this.insertSubtask(
					current,
					args.parent,
					taskContent
				);
			} else {
				// Use heading from Quick Capture settings if available
				const fallbackHeading =
					args.heading ||
					this.plugin.settings.quickCapture?.targetHeading?.trim();
				if (fallbackHeading) {
					const headingRegex = new RegExp(
						`^#{1,6}\\s+${fallbackHeading.replace(
							/[.*+?^${}()|[\]\\]/g,
							"\\$&"
						)}\\s*$`,
						"m"
					);
					if (headingRegex.test(current)) {
						newContent = current.replace(
							headingRegex,
							`$&\n\n${taskContent}`
						);
					} else {
						newContent = `${current}${
							current.endsWith("\n") ? "" : "\n"
						}\n## ${fallbackHeading}\n\n${taskContent}`;
					}
				} else {
					newContent = current
						? `${current}\n${taskContent}`
						: taskContent;
				}
			}

			// Notify about write operation
			emit(this.app, Events.WRITE_OPERATION_START, {path: file.path});
			await this.vault.modify(file, newContent);
			emit(this.app, Events.WRITE_OPERATION_COMPLETE, {
				path: file.path,
			});
			return {success: true};
		} catch (error) {
			console.error(
				"WriteAPI: Error creating task in daily note:",
				error
			);
			return {success: false, error: String(error)};
		}
	}

	/**
	 * Add a project task to quick capture
	 */
	async addProjectTaskToQuickCapture(args: {
		content: string;
		project: string;
		tags?: string[];
		priority?: number;
		dueDate?: string;
		startDate?: string;
		context?: string;
		heading?: string;
		completed?: boolean;
		completedDate?: string;
	}): Promise<{ filePath: string; success: boolean }> {
		try {
			const qc = this.plugin.settings.quickCapture;
			if (!qc) {
				throw new Error("Quick Capture settings not found");
			}

			// Build task line
			const checkboxState = args.completed ? "[x]" : "[ ]";
			let line = `- ${checkboxState} ${args.content}`;
			const metadata = this.generateMetadata({
				tags: args.tags,
				project: args.project,
				context: args.context,
				priority: args.priority,
				startDate: args.startDate
					? moment(args.startDate).valueOf()
					: undefined,
				dueDate: args.dueDate
					? moment(args.dueDate).valueOf()
					: undefined,
				completed: args.completed,
				completedDate: args.completedDate
					? moment(args.completedDate).valueOf()
					: undefined,
			});
			if (metadata) {
				line += ` ${metadata}`;
			}

			// Compute target filePath
			let filePath: string;
			if (qc.targetType === "daily-note" && qc.dailyNoteSettings) {
				const dateStr = moment().format(
					qc.dailyNoteSettings.format || "YYYY-MM-DD"
				);
				filePath =
					(qc.dailyNoteSettings.folder
						? `${qc.dailyNoteSettings.folder.replace(/\/$/, "")}/`
						: "") + `${dateStr}.md`;
			} else {
				filePath = processDateTemplates(
					qc.targetFile || "Quick Capture.md"
				);
			}

			// Save using shared saver
			await saveCapture(this.app, line, {
				targetFile: qc.targetFile,
				appendToFile: qc.appendToFile,
				targetType: qc.targetType,
				targetHeading: args.heading || qc.targetHeading,
				dailyNoteSettings: qc.dailyNoteSettings,
			});

			return {filePath, success: true};
		} catch (error) {
			console.error(
				"WriteAPI: Error adding project task to quick capture:",
				error
			);
			return {filePath: "", success: false};
		}
	}

	/**
	 * Generate metadata string based on format preference
	 */
	private generateMetadata(args: {
		tags?: string[];
		project?: string;
		context?: string;
		priority?: number;
		startDate?: number;
		dueDate?: number;
		scheduledDate?: number;
		recurrence?: string;
		completed?: boolean;
		completedDate?: number;
	}): string {
		const metadata: string[] = [];
		const useDataviewFormat =
			this.plugin.settings.preferMetadataFormat === "dataview";

		// Tags
		if (args.tags?.length) {
			if (useDataviewFormat) {
				metadata.push(`[tags:: ${args.tags.join(", ")}]`);
			} else {
				// Ensure tags don't already have # prefix before adding one
				metadata.push(
					...args.tags.map((tag) =>
						tag.startsWith("#") ? tag : `#${tag}`
					)
				);
			}
		}

		// Project
		if (args.project) {
			if (useDataviewFormat) {
				const projectPrefix =
					this.plugin.settings.projectTagPrefix?.dataview ||
					"project";
				metadata.push(`[${projectPrefix}:: ${args.project}]`);
			} else {
				const projectPrefix =
					this.plugin.settings.projectTagPrefix?.tasks || "project";
				metadata.push(`#${projectPrefix}/${args.project}`);
			}
		}

		// Context
		if (args.context) {
			if (useDataviewFormat) {
				const contextPrefix =
					this.plugin.settings.contextTagPrefix?.dataview ||
					"context";
				metadata.push(`[${contextPrefix}:: ${args.context}]`);
			} else {
				const contextPrefix =
					this.plugin.settings.contextTagPrefix?.tasks || "@";
				metadata.push(`${contextPrefix}${args.context}`);
			}
		}

		// Priority
		// Only add priority if it's a valid number between 1-5
		if (
			typeof args.priority === "number" &&
			args.priority >= 1 &&
			args.priority <= 5
		) {
			if (useDataviewFormat) {
				let priorityValue: string;
				switch (args.priority) {
					case 5:
						priorityValue = "highest";
						break;
					case 4:
						priorityValue = "high";
						break;
					case 3:
						priorityValue = "medium";
						break;
					case 2:
						priorityValue = "low";
						break;
					case 1:
						priorityValue = "lowest";
						break;
					default:
						priorityValue = String(args.priority);
				}
				metadata.push(`[priority:: ${priorityValue}]`);
			} else {
				let priorityMarker = "";
				switch (args.priority) {
					case 5:
						priorityMarker = "🔺";
						break;
					case 4:
						priorityMarker = "⏫";
						break;
					case 3:
						priorityMarker = "🔼";
						break;
					case 2:
						priorityMarker = "🔽";
						break;
					case 1:
						priorityMarker = "⏬";
						break;
				}
				if (priorityMarker) metadata.push(priorityMarker);
			}
		}

		// Recurrence
		if (args.recurrence) {
			metadata.push(
				useDataviewFormat
					? `[repeat:: ${args.recurrence}]`
					: `🔁 ${args.recurrence}`
			);
		}

		// Start Date
		if (args.startDate) {
			const dateStr = moment(args.startDate).format("YYYY-MM-DD");
			metadata.push(
				useDataviewFormat ? `[start:: ${dateStr}]` : `🛫 ${dateStr}`
			);
		}

		// Scheduled Date
		if (args.scheduledDate) {
			const dateStr = moment(args.scheduledDate).format("YYYY-MM-DD");
			metadata.push(
				useDataviewFormat ? `[scheduled:: ${dateStr}]` : `⏳ ${dateStr}`
			);
		}

		// Due Date
		if (args.dueDate) {
			const dateStr = moment(args.dueDate).format("YYYY-MM-DD");
			metadata.push(
				useDataviewFormat ? `[due:: ${dateStr}]` : `📅 ${dateStr}`
			);
		}

		// Completion Date
		if (args.completed && args.completedDate) {
			const dateStr = moment(args.completedDate).format("YYYY-MM-DD");
			metadata.push(
				useDataviewFormat
					? `[completion:: ${dateStr}]`
					: `✅ ${dateStr}`
			);
		}

		return metadata.join(" ");
	}

	/**
	 * Insert a subtask under a parent task
	 */
	private insertSubtask(
		content: string,
		parentTaskId: string,
		subtaskContent: string
	): string {
		const lines = content.split("\n");
		const parentTask = this.findTaskLineById(lines, parentTaskId);

		if (parentTask) {
			const indent = this.getIndent(lines[parentTask.line]);
			const subtaskIndent = indent + "\t";
			lines.splice(
				parentTask.line + 1,
				0,
				subtaskIndent + subtaskContent.trim()
			);
		}

		return lines.join("\n");
	}

	/**
	 * Find task line by ID
	 */
	private findTaskLineById(
		lines: string[],
		taskId: string
	): { line: number } | null {
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].includes(taskId)) {
				return {line: i};
			}
		}
		return null;
	}

	/**
	 * Get indentation of a line
	 */
	private getIndent(line: string): string {
		const match = line.match(/^(\s*)/);
		return match ? match[1] : "";
	}

	/**
	 * Parse date or relative offset
	 */
	private parseDateOrOffset(input: string): number | null {
		// Absolute YYYY-MM-DD
		const abs = Date.parse(input);
		if (!isNaN(abs)) return abs;

		// Relative +Nd/+Nw/+Nm/+Ny
		const m = input.match(/^\+(\d+)([dwmy])$/i);
		if (!m) return null;

		const n = parseInt(m[1], 10);
		const unit = m[2].toLowerCase();
		const base = new Date();

		switch (unit) {
			case "d":
				base.setDate(base.getDate() + n);
				break;
			case "w":
				base.setDate(base.getDate() + n * 7);
				break;
			case "m":
				base.setMonth(base.getMonth() + n);
				break;
			case "y":
				base.setFullYear(base.getFullYear() + n);
				break;
		}

		// Normalize to local midnight
		base.setHours(0, 0, 0, 0);
		return base.getTime();
	}

	// ===== Canvas Task Methods =====

	/**
	 * Update a Canvas task
	 */
	async updateCanvasTask(
		args: UpdateTaskArgs
	): Promise<{ success: boolean; task?: Task; error?: string }> {
		try {
			const originalTask = await Promise.resolve(
				this.getTaskById(args.taskId)
			);
			if (!originalTask) {
				return {success: false, error: "Task not found"};
			}

			// Ensure it's a Canvas task
			if (!CanvasTaskUpdater.isCanvasTask(originalTask)) {
				return {success: false, error: "Task is not a Canvas task"};
			}

			// Create updated task object (deep-merge metadata to preserve unchanged fields)
			const updatedTask = {
				...originalTask,
				...args.updates,
				metadata: {
					...originalTask.metadata,
					...(args.updates as any).metadata,
				},
			} as Task<CanvasTaskMetadata>;

			// Use CanvasTaskUpdater to update the task
			const result = await this.canvasTaskUpdater.updateCanvasTask(
				originalTask as Task<CanvasTaskMetadata>,
				updatedTask
			);

			if (result.success) {
				// Emit task updated event for dataflow
				emit(this.app, Events.TASK_UPDATED, {task: updatedTask});

				// Trigger task-completed event if task was just completed
				if (
					args.updates.completed === true &&
					!originalTask.completed
				) {
					this.app.workspace.trigger(
						"task-genius:task-completed",
						updatedTask
					);
				}

				return {success: true, task: updatedTask};
			} else {
				return {success: false, error: result.error};
			}
		} catch (error) {
			console.error("WriteAPI: Error updating Canvas task:", error);
			return {success: false, error: String(error)};
		}
	}

	/**
	 * Delete a Canvas task
	 */
	async deleteCanvasTask(
		args: DeleteTaskArgs
	): Promise<{ success: boolean; error?: string }> {
		try {
			const task = await Promise.resolve(this.getTaskById(args.taskId));
			if (!task) {
				return {success: false, error: "Task not found"};
			}

			// Ensure it's a Canvas task
			if (!CanvasTaskUpdater.isCanvasTask(task)) {
				return {success: false, error: "Task is not a Canvas task"};
			}

			// Collect all tasks to delete
			const deletedTaskIds: string[] = [args.taskId];

			if (args.deleteChildren) {
				// Get all descendant tasks
				const descendantIds = await this.getDescendantTaskIds(
					args.taskId
				);
				deletedTaskIds.push(...descendantIds);
			}

			// Use CanvasTaskUpdater to delete the task(s)
			const result = await this.canvasTaskUpdater.deleteCanvasTask(
				task as Task<CanvasTaskMetadata>,
				args.deleteChildren
			);

			if (result.success) {
				// Emit TASK_DELETED event with all deleted task IDs
				emit(this.app, Events.TASK_DELETED, {
					taskId: args.taskId,
					filePath: task.filePath,
					deletedTaskIds,
					mode: args.deleteChildren ? "subtree" : "single",
				});
			}

			return result;
		} catch (error) {
			console.error("WriteAPI: Error deleting Canvas task:", error);
			return {success: false, error: String(error)};
		}
	}

	/**
	 * Move a Canvas task to another location
	 */
	async moveCanvasTask(args: {
		taskId: string;
		targetFilePath: string;
		targetNodeId?: string;
		targetSection?: string;
	}): Promise<{ success: boolean; error?: string }> {
		try {
			const task = await Promise.resolve(this.getTaskById(args.taskId));
			if (!task) {
				return {success: false, error: "Task not found"};
			}

			// Ensure it's a Canvas task
			if (!CanvasTaskUpdater.isCanvasTask(task)) {
				return {success: false, error: "Task is not a Canvas task"};
			}

			// Use CanvasTaskUpdater to move the task
			const result = await this.canvasTaskUpdater.moveCanvasTask(
				task as Task<CanvasTaskMetadata>,
				args.targetFilePath,
				args.targetNodeId,
				args.targetSection
			);

			return result;
		} catch (error) {
			console.error("WriteAPI: Error moving Canvas task:", error);
			return {success: false, error: String(error)};
		}
	}

	/**
	 * Duplicate a Canvas task
	 */
	async duplicateCanvasTask(args: {
		taskId: string;
		targetFilePath?: string;
		targetNodeId?: string;
		targetSection?: string;
		preserveMetadata?: boolean;
	}): Promise<{ success: boolean; error?: string }> {
		try {
			const task = await Promise.resolve(this.getTaskById(args.taskId));
			if (!task) {
				return {success: false, error: "Task not found"};
			}

			// Ensure it's a Canvas task
			if (!CanvasTaskUpdater.isCanvasTask(task)) {
				return {success: false, error: "Task is not a Canvas task"};
			}

			// Use CanvasTaskUpdater to duplicate the task
			const result = await this.canvasTaskUpdater.duplicateCanvasTask(
				task as Task<CanvasTaskMetadata>,
				args.targetFilePath,
				args.targetNodeId,
				args.targetSection,
				args.preserveMetadata
			);

			return result;
		} catch (error) {
			console.error("WriteAPI: Error duplicating Canvas task:", error);
			return {success: false, error: String(error)};
		}
	}

	/**
	 * Add a new task to a Canvas node
	 */
	async addTaskToCanvasNode(args: {
		filePath: string;
		content: string;
		targetNodeId?: string;
		targetSection?: string;
		completed?: boolean;
		metadata?: Partial<CanvasTaskMetadata>;
	}): Promise<{ success: boolean; error?: string }> {
		try {
			// Format task content with checkbox
			const checkboxState = args.completed ? "[x]" : "[ ]";
			let taskContent = `- ${checkboxState} ${args.content}`;

			// Add metadata if provided
			if (args.metadata) {
				const metadataStr = this.generateMetadata(args.metadata as any);
				if (metadataStr) {
					taskContent += ` ${metadataStr}`;
				}
			}

			// Use CanvasTaskUpdater to add the task
			const result = await this.canvasTaskUpdater.addTaskToCanvasNode(
				args.filePath,
				taskContent,
				args.targetNodeId,
				args.targetSection
			);

			return result;
		} catch (error) {
			console.error("WriteAPI: Error adding task to Canvas node:", error);
			return {success: false, error: String(error)};
		}
	}

	/**
	 * Check if a task is a Canvas task
	 */
	isCanvasTask(task: Task): boolean {
		return CanvasTaskUpdater.isCanvasTask(task);
	}

	/**
	 * Get the Canvas task updater instance
	 */
	getCanvasTaskUpdater(): CanvasTaskUpdater {
		return this.canvasTaskUpdater;
	}
}
