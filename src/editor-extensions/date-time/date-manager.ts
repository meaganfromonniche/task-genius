import { App } from "obsidian";
import {
	EditorState,
	Text,
	Transaction,
	TransactionSpec,
} from "@codemirror/state";
import TaskProgressBarPlugin from "../../index";
import { taskStatusChangeAnnotation } from "../task-operations/status-switcher";

/**
 * Creates an editor extension that automatically manages dates based on task status changes
 * @param app The Obsidian app instance
 * @param plugin The plugin instance
 * @returns An editor extension that can be registered with the plugin
 */
export function autoDateManagerExtension(
	app: App,
	plugin: TaskProgressBarPlugin
) {
	return EditorState.transactionFilter.of((tr) => {
		return handleAutoDateManagerTransaction(tr, app, plugin);
	});
}

/**
 * Handles transactions to detect task status changes and manage dates accordingly
 * @param tr The transaction to handle
 * @param app The Obsidian app instance
 * @param plugin The plugin instance
 * @returns The original transaction or a modified transaction
 */
function handleAutoDateManagerTransaction(
	tr: Transaction,
	app: App,
	plugin: TaskProgressBarPlugin
): TransactionSpec {
	// Only process transactions that change the document
	if (!tr.docChanged) {
		return tr;
	}

	// Skip if auto date management is disabled
	if (!plugin.settings.autoDateManager?.enabled) {
		return tr;
	}

	// Skip if this transaction was triggered by auto date management itself
	const annotationValue = tr.annotation(taskStatusChangeAnnotation);
	if (
		typeof annotationValue === "string" &&
		annotationValue.includes("autoDateManager")
	) {
		return tr;
	}

	// Skip if this is a paste operation or other bulk operations
	if (tr.isUserEvent("input.paste") || tr.isUserEvent("set")) {
		return tr;
	}

	// Skip if this looks like a move operation (delete + insert of same content)
	if (isMoveOperation(tr)) {
		return tr;
	}

	// Check if a task status was changed in this transaction
	const taskStatusChangeInfo = findTaskStatusChange(tr);

	if (!taskStatusChangeInfo) {
		return tr;
	}

	const {doc, lineNumber, oldStatus, newStatus} = taskStatusChangeInfo;

	// Determine what date operations need to be performed
	const dateOperations = determineDateOperations(
		oldStatus,
		newStatus,
		plugin,
		doc.line(lineNumber).text
	);

	if (dateOperations.length === 0) {
		return tr;
	}

	// Apply date operations to the task line
	return applyDateOperations(tr, doc, lineNumber, dateOperations, plugin);
}

/**
 * Detects if a transaction represents a move operation (line reordering)
 * @param tr The transaction to check
 * @returns True if this appears to be a move operation
 */
function isMoveOperation(tr: Transaction): boolean {
	const changes: Array<{
		type: "delete" | "insert";
		content: string;
		fromA: number;
		toA: number;
		fromB: number;
		toB: number;
	}> = [];

	// Collect all changes in the transaction
	tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
		// Record deletions
		if (fromA < toA) {
			const deletedText = tr.startState.doc.sliceString(fromA, toA);
			changes.push({
				type: "delete",
				content: deletedText,
				fromA,
				toA,
				fromB,
				toB,
			});
		}

		// Record insertions
		if (inserted.length > 0) {
			changes.push({
				type: "insert",
				content: inserted.toString(),
				fromA,
				toA,
				fromB,
				toB,
			});
		}
	});

	// Check if we have both deletions and insertions
	const deletions = changes.filter((c) => c.type === "delete");
	const insertions = changes.filter((c) => c.type === "insert");

	if (deletions.length === 0 || insertions.length === 0) {
		return false;
	}

	// Check if any deleted content matches any inserted content
	// This could indicate a move operation
	for (const deletion of deletions) {
		for (const insertion of insertions) {
			// Check for exact match or match with whitespace differences
			const deletedLines = deletion.content
				.split("\n")
				.filter((line) => line.trim());
			const insertedLines = insertion.content
				.split("\n")
				.filter((line) => line.trim());

			if (
				deletedLines.length === insertedLines.length &&
				deletedLines.length > 0
			) {
				let isMatch = true;
				for (let i = 0; i < deletedLines.length; i++) {
					// Compare content without leading/trailing whitespace but preserve task structure
					const deletedLine = deletedLines[i].trim();
					const insertedLine = insertedLines[i].trim();
					if (deletedLine !== insertedLine) {
						isMatch = false;
						break;
					}
				}
				if (isMatch) {
					return true;
				}
			}
		}
	}

	return false;
}

/**
 * Finds any task status change in the transaction
 * @param tr The transaction to check
 * @returns Information about the task with changed status or null if no task status was changed
 */
function findTaskStatusChange(tr: Transaction): {
	doc: Text;
	lineNumber: number;
	oldStatus: string;
	newStatus: string;
} | null {
	let taskChangedInfo: {
		doc: Text;
		lineNumber: number;
		oldStatus: string;
		newStatus: string;
	} | null = null;

	// Check each change in the transaction
	tr.changes.iterChanges(
		(
			fromA: number,
			toA: number,
			fromB: number,
			toB: number,
			inserted: Text
		) => {
			// Only process actual insertions that contain task markers
			if (inserted.length === 0) {
				return;
			}

			// Get the position context
			const pos = fromB;
			const newLine = tr.newDoc.lineAt(pos);
			const newLineText = newLine.text;

			// Check if this line contains a task marker
			const taskRegex = /^[\s|\t]*([-*+]|\d+\.)\s\[(.)]/i;
			const newTaskMatch = newLineText.match(taskRegex);

			if (newTaskMatch) {
				const newStatus = newTaskMatch[2];
				let oldStatus = " ";

				// Try to find the corresponding old task status
				// First, check if there was a deletion in this transaction that might correspond
				let foundCorrespondingOldTask = false;

				tr.changes.iterChanges(
					(oldFromA, oldToA, oldFromB, oldToB, oldInserted) => {
						// Look for deletions that might correspond to this insertion
						if (oldFromA < oldToA && !foundCorrespondingOldTask) {
							try {
								const deletedText =
									tr.startState.doc.sliceString(
										oldFromA,
										oldToA
									);
								const deletedLines = deletedText.split("\n");

								for (const deletedLine of deletedLines) {
									const oldTaskMatch =
										deletedLine.match(taskRegex);
									if (oldTaskMatch) {
										// Compare the task content (without status) to see if it's the same task
										const newTaskContent = newLineText
											.replace(taskRegex, "")
											.trim();
										const oldTaskContent = deletedLine
											.replace(taskRegex, "")
											.trim();

										// If the content matches, this is likely the same task
										if (newTaskContent === oldTaskContent) {
											oldStatus = oldTaskMatch[2];
											foundCorrespondingOldTask = true;
											break;
										}
									}
								}
							} catch (e) {
								// Ignore errors when trying to get deleted text
							}
						}
					}
				);

				// If we couldn't find a corresponding old task, try the original method
				if (!foundCorrespondingOldTask) {
					try {
						// Check if the change is actually modifying the task status character
						const taskStatusStart = newLineText.indexOf("[") + 1;
						const taskStatusEnd = newLineText.indexOf("]");

						// Only proceed if the change affects the task status area
						if (
							fromB <= newLine.from + taskStatusEnd &&
							toB >= newLine.from + taskStatusStart
						) {
							const oldPos = fromA;
							if (
								oldPos >= 0 &&
								oldPos < tr.startState.doc.length
							) {
								const oldLine =
									tr.startState.doc.lineAt(oldPos);
								const oldTaskMatch =
									oldLine.text.match(taskRegex);
								if (oldTaskMatch) {
									oldStatus = oldTaskMatch[2];
									foundCorrespondingOldTask = true;
								}
							}
						}
					} catch (e) {
						// Line might not exist in old document
					}
				}

				// Only process if we found a corresponding old task and the status actually changed
				if (foundCorrespondingOldTask && oldStatus !== newStatus) {
					taskChangedInfo = {
						doc: tr.newDoc,
						lineNumber: newLine.number,
						oldStatus: oldStatus,
						newStatus: newStatus,
					};
				}
			}
		}
	);

	return taskChangedInfo;
}

/**
 * Determines what date operations need to be performed based on status change
 * @param oldStatus The old task status
 * @param newStatus The new task status
 * @param plugin The plugin instance
 * @param lineText The current line text to check for existing dates
 * @returns Array of date operations to perform
 */
function determineDateOperations(
	oldStatus: string,
	newStatus: string,
	plugin: TaskProgressBarPlugin,
	lineText: string
): DateOperation[] {
	const operations: DateOperation[] = [];
	const settings = plugin.settings.autoDateManager;

	if (!settings) return operations;

	const oldStatusType = getStatusType(oldStatus, plugin);
	const newStatusType = getStatusType(newStatus, plugin);

	// If status types are the same, no date operations needed
	if (oldStatusType === newStatusType) {
		return operations;
	}

	// Remove old status date if it exists and is managed (but never remove start date)
	if (settings.manageCompletedDate && oldStatusType === "completed") {
		operations.push({
			type: "remove",
			dateType: "completed",
		});
	}
	if (settings.manageCancelledDate && oldStatusType === "abandoned") {
		operations.push({
			type: "remove",
			dateType: "cancelled",
		});
	}

	// Add new status date if it should be managed and doesn't already exist
	if (settings.manageCompletedDate && newStatusType === "completed") {
		operations.push({
			type: "add",
			dateType: "completed",
			format: settings.completedDateFormat || "YYYY-MM-DD",
		});
	}
	if (settings.manageStartDate && newStatusType === "inProgress") {
		// Only add start date if it doesn't already exist
		if (!hasExistingDate(lineText, "start", plugin)) {
			operations.push({
				type: "add",
				dateType: "start",
				format: settings.startDateFormat || "YYYY-MM-DD",
			});
		}
	}
	if (settings.manageCancelledDate && newStatusType === "abandoned") {
		operations.push({
			type: "add",
			dateType: "cancelled",
			format: settings.cancelledDateFormat || "YYYY-MM-DD",
		});
	}

	return operations;
}

/**
 * Checks if a specific date type already exists in the line
 * @param lineText The task line text
 * @param dateType The type of date to check for
 * @param plugin The plugin instance
 * @returns True if the date already exists
 */
function hasExistingDate(
	lineText: string,
	dateType: string,
	plugin: TaskProgressBarPlugin
): boolean {
	const useDataviewFormat =
		plugin.settings.preferMetadataFormat === "dataview";

	if (useDataviewFormat) {
		const fieldName = dateType === "start" ? "start" : dateType;
		const pattern = new RegExp(
			`\\[${fieldName}::\\s*\\d{4}-\\d{2}-\\d{2}(?:\\s+\\d{2}:\\d{2}(?::\\d{2})?)?\\]`
		);
		return pattern.test(lineText);
	} else {
		const dateMarker = getDateMarker(dateType, plugin);
		const pattern = new RegExp(
			`${escapeRegex(
				dateMarker
			)}\\s*\\d{4}-\\d{2}-\\d{2}(?:\\s+\\d{2}:\\d{2}(?::\\d{2})?)?`
		);
		return pattern.test(lineText);
	}
}

/**
 * Gets the status type (completed, inProgress, etc.) for a given status character
 * @param status The status character
 * @param plugin The plugin instance
 * @returns The status type
 */
function getStatusType(status: string, plugin: TaskProgressBarPlugin): string {
	const taskStatuses = plugin.settings.taskStatuses;

	if (taskStatuses.completed.split("|").includes(status)) {
		return "completed";
	}
	if (taskStatuses.inProgress.split("|").includes(status)) {
		return "inProgress";
	}
	if (taskStatuses.abandoned.split("|").includes(status)) {
		return "abandoned";
	}
	if (taskStatuses.planned.split("|").includes(status)) {
		return "planned";
	}
	if (taskStatuses.notStarted.split("|").includes(status)) {
		return "notStarted";
	}

	return "unknown";
}

/**
 * Applies date operations to the task line
 * @param tr The transaction
 * @param doc The document
 * @param lineNumber The line number of the task
 * @param operations The date operations to perform
 * @param plugin The plugin instance
 * @returns The modified transaction
 */
function applyDateOperations(
	tr: Transaction,
	doc: Text,
	lineNumber: number,
	operations: DateOperation[],
	plugin: TaskProgressBarPlugin
): TransactionSpec {
	// IMPORTANT: Use the NEW document state, not the old one
	const line = tr.newDoc.line(lineNumber);
	let lineText = line.text;
	const changes = [];

	console.log(`[AutoDateManager] applyDateOperations - Working with line: "${lineText}"`);

	for (const operation of operations) {
		if (operation.type === "add") {
			// Add a new date
			const dateString = formatDate(operation.format!);
			const dateMarker = getDateMarker(operation.dateType, plugin);
			const useDataviewFormat =
				plugin.settings.preferMetadataFormat === "dataview";

			let dateText: string;
			if (useDataviewFormat) {
				dateText = ` ${dateMarker}${dateString}]`;
			} else {
				dateText = ` ${dateMarker} ${dateString}`;
			}

			// Find the appropriate insert position based on date type
			let insertPosition: number;
			if (operation.dateType === "completed") {
				// Completed date goes at the end (before block reference ID)
				insertPosition = findCompletedDateInsertPosition(
					lineText,
					plugin
				);
			} else {
				// Start date and cancelled date go after existing metadata but before completed date
				insertPosition = findMetadataInsertPosition(
					lineText,
					plugin,
					operation.dateType
				);
			}

			const absolutePosition = line.from + insertPosition;

			console.log(`[AutoDateManager] Inserting ${operation.dateType} date:`);
			console.log(`  - Insert position (relative): ${insertPosition}`);
			console.log(`  - Line.from: ${line.from}`);
			console.log(`  - Absolute position: ${absolutePosition}`);
			console.log(`  - Date text: "${dateText}"`);
			console.log(`  - Text at insert point: "${lineText.substring(insertPosition)}"`);

			changes.push({
				from: absolutePosition,
				to: absolutePosition,
				insert: dateText,
			});

			// Update lineText for subsequent operations
			lineText =
				lineText.slice(0, insertPosition) +
				dateText +
				lineText.slice(insertPosition);
		} else if (operation.type === "remove") {
			// Remove existing date
			const useDataviewFormat =
				plugin.settings.preferMetadataFormat === "dataview";
			let datePattern: RegExp;

			if (useDataviewFormat) {
				// For dataview format: [completion::2024-01-01] or [cancelled::2024-01-01]
				const fieldName =
					operation.dateType === "completed"
						? "completion"
						: operation.dateType === "cancelled"
							? "cancelled"
							: "unknown";
				datePattern = new RegExp(
					`\\s*\\[${fieldName}::\\s*\\d{4}-\\d{2}-\\d{2}(?:\\s+\\d{2}:\\d{2}(?::\\d{2})?)?\\]`,
					"g"
				);
			} else {
				// For emoji format: ✅ 2024-01-01 or ❌ 2024-01-01
				const dateMarker = getDateMarker(operation.dateType, plugin);
				datePattern = new RegExp(
					`\\s*${escapeRegex(
						dateMarker
					)}\\s*\\d{4}-\\d{2}-\\d{2}(?:\\s+\\d{2}:\\d{2}(?::\\d{2})?)?`,
					"g"
				);
			}

			// Find all matches and remove them (there might be multiple instances)
			// Work with the full lineText
			let match;
			const matchesToRemove = [];
			datePattern.lastIndex = 0; // Reset regex state

			while ((match = datePattern.exec(lineText)) !== null) {
				matchesToRemove.push({
					start: match.index,
					end: match.index + match[0].length,
					text: match[0],
				});
			}

			// Process matches in reverse order to maintain correct positions
			for (let i = matchesToRemove.length - 1; i >= 0; i--) {
				const matchToRemove = matchesToRemove[i];
				const absoluteFrom = line.from + matchToRemove.start;
				const absoluteTo = line.from + matchToRemove.end;

				changes.push({
					from: absoluteFrom,
					to: absoluteTo,
					insert: "",
				});

				// Update lineText for subsequent operations
				lineText =
					lineText.slice(0, matchToRemove.start) +
					lineText.slice(matchToRemove.end);
			}
		}
	}

	if (changes.length > 0) {
		return {
			changes: [tr.changes, ...changes],
			selection: tr.selection,
			annotations: [
				taskStatusChangeAnnotation.of("autoDateManager.dateUpdate"),
			],
		};
	}

	return tr;
}

/**
 * Formats a date according to the specified format
 * @param format The date format string
 * @returns The formatted date string
 */
function formatDate(format: string): string {
	const now = new Date();

	// Simple date formatting - you might want to use a more robust library
	return format
		.replace("YYYY", now.getFullYear().toString())
		.replace("MM", (now.getMonth() + 1).toString().padStart(2, "0"))
		.replace("DD", now.getDate().toString().padStart(2, "0"))
		.replace("HH", now.getHours().toString().padStart(2, "0"))
		.replace("mm", now.getMinutes().toString().padStart(2, "0"))
		.replace("ss", now.getSeconds().toString().padStart(2, "0"));
}

/**
 * Gets the date marker for a specific date type based on metadata format
 * @param dateType The type of date (completed, start, cancelled)
 * @param plugin The plugin instance
 * @returns The date marker string
 */
function getDateMarker(
	dateType: string,
	plugin: TaskProgressBarPlugin
): string {
	const settings = plugin.settings.autoDateManager;
	const useDataviewFormat =
		plugin.settings.preferMetadataFormat === "dataview";

	if (!settings) return "📅";

	switch (dateType) {
		case "completed":
			if (useDataviewFormat) {
				return "[completion::";
			}
			return settings.completedDateMarker || "✅";
		case "start":
			if (useDataviewFormat) {
				return "[start::";
			}
			return settings.startDateMarker || "🚀";
		case "cancelled":
			if (useDataviewFormat) {
				return "[cancelled::";
			}
			return settings.cancelledDateMarker || "❌";
		default:
			return "📅";
	}
}

/**
 * Finds the position where metadata (start date, cancelled date, etc.) should be inserted
 * @param lineText The task line text
 * @param plugin The plugin instance
 * @param dateType The type of date being inserted
 * @returns The position index where the metadata should be inserted
 */
function findMetadataInsertPosition(
	lineText: string,
	plugin: TaskProgressBarPlugin,
	dateType: string
): number {
	// Work with the full line text, don't extract block reference yet
	const blockRef = detectBlockReference(lineText);

	// Find the end of the task content, right after the task description
	const taskMatch = lineText.match(/^[\s|\t]*([-*+]|\d+\.)\s\[.\]\s*/);
	if (!taskMatch) return blockRef ? blockRef.index : lineText.length;

	let position = taskMatch[0].length;

	// For cancelled date, we need special handling to insert after all metadata and start dates
	if (dateType === "cancelled") {
		const useDataviewFormat = plugin.settings.preferMetadataFormat === "dataview";

		// Find the last occurrence of either:
		// 1. Start date marker (🛫 or [start::)
		// 2. If no start date, find the end of all metadata

		// Look for start date first
		let startDateFound = false;
		if (useDataviewFormat) {
			const startDateMatch = lineText.match(/\[start::[^\]]*\]/);
			if (startDateMatch && startDateMatch.index !== undefined) {
				position = startDateMatch.index + startDateMatch[0].length;
				startDateFound = true;
			}
		} else {
			// First try with the configured start marker
			const startMarker = getDateMarker("start", plugin);
			const escapedStartMarker = escapeRegex(startMarker);
			const startDatePattern = new RegExp(
				`${escapedStartMarker}\\s*\\d{4}-\\d{2}-\\d{2}(?:\\s+\\d{2}:\\d{2}(?::\\d{2})?)?`
			);
			let startDateMatch = lineText.match(startDatePattern);

			// If not found, look for any common start date emoji patterns
			if (!startDateMatch) {
				// Common start date emojis: 🚀, 🛫, ▶️, ⏰, 🏁
				const commonStartEmojis = ["🚀", "🛫", "▶️", "⏰", "🏁"];
				for (const emoji of commonStartEmojis) {
					const pattern = new RegExp(
						`${escapeRegex(emoji)}\\s*\\d{4}-\\d{2}-\\d{2}(?:\\s+\\d{2}:\\d{2}(?::\\d{2})?)?`
					);
					startDateMatch = lineText.match(pattern);
					if (startDateMatch) {
						console.log(`[AutoDateManager] Found start date with emoji ${emoji}`);
						break;
					}
				}
			}

			if (startDateMatch && startDateMatch.index !== undefined) {
				position = startDateMatch.index + startDateMatch[0].length;
				startDateFound = true;
				console.log(`[AutoDateManager] Found start date at index ${startDateMatch.index}, length ${startDateMatch[0].length}, new position: ${position}`);
			}
		}

		console.log(`[AutoDateManager] Start date found: ${startDateFound}, position: ${position}`);

		if (!startDateFound) {
			// No start date found, find the end of all metadata
			// This includes tags (#), dataview fields ([field::]), and other date markers
			let lastMetadataEnd = position;

			// Find all metadata occurrences
			const metadataRegexes = [
				/#[\w-]+/g, // Tags
				/\[[a-zA-Z]+::[^\]]*\]/g, // Dataview fields
				/[📅🚀✅❌🛫▶️⏰🏁]\s*\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}(?::\d{2})?)?/g // Date markers (including all common start emojis)
			];

			for (const regex of metadataRegexes) {
				let match;
				while ((match = regex.exec(lineText)) !== null) {
					if (match.index >= position) {
						const matchEnd = match.index + match[0].length;
						if (matchEnd > lastMetadataEnd) {
							lastMetadataEnd = matchEnd;
						}
					}
				}
			}

			position = lastMetadataEnd;
		}

		// Ensure we have a space before the cancelled date
		if (position > 0 && lineText[position - 1] !== ' ') {
			// No need to add space here, it will be added with the date
		}
	} else if (dateType === "completed") {
		// For completed date, we want to go to the end of the line (before block reference)
		// This is different from cancelled/start dates which go after content/metadata
		position = lineText.length;

		// If there's a block reference, insert before it
		if (blockRef) {
			position = blockRef.index;
			// Remove trailing space if exists
			if (position > 0 && lineText[position - 1] === ' ') {
				position--;
			}
		}
	} else {
		// For start date, find the end of main content before metadata
		let contentEnd = position;
		let inBrackets = false;
		const chars = lineText.slice(position).split('');

		for (let i = 0; i < chars.length; i++) {
			const char = chars[i];

			// Track if we're inside dataview brackets
			if (char === '[' && !inBrackets) {
				// Check if this is a dataview field like [due::...]
				const remainingText = lineText.slice(position + i);
				if (remainingText.match(/^\[[a-zA-Z]+::/)) {
					// This is metadata, stop here
					break;
				}
				inBrackets = true;
				contentEnd = position + i + 1;
			} else if (char === ']' && inBrackets) {
				inBrackets = false;
				contentEnd = position + i + 1;
			} else if (!inBrackets) {
				// Check for metadata markers when not inside brackets
				if (char === '#' || char === '📅' || char === '🚀' || char === '✅' || char === '❌' || char === '🛫' || char === '▶️' || char === '⏰' || char === '🏁') {
					// This is metadata, stop here
					break;
				}
				contentEnd = position + i + 1;
			} else {
				// Inside brackets, keep going
				contentEnd = position + i + 1;
			}
		}

		position = contentEnd;

		// Trim any trailing whitespace from position
		while (position > 0 && lineText[position - 1] === ' ') {
			position--;
		}
	}

	// Ensure position doesn't exceed the block reference position
	if (blockRef && position > blockRef.index) {
		position = blockRef.index;
		// Remove trailing space if it exists
		if (position > 0 && lineText[position - 1] === ' ') {
			position--;
		}
	}

	console.log(`[AutoDateManager] Final insert position for ${dateType}: ${position}`);
	return position;
}

/**
 * Finds the position where completed date should be inserted (at the end, before block reference ID)
 * @param lineText The task line text
 * @param plugin The plugin instance
 * @returns The position index where the completed date should be inserted
 */
function findCompletedDateInsertPosition(
	lineText: string,
	plugin: TaskProgressBarPlugin
): number {
	// Use centralized block reference detection
	const blockRef = detectBlockReference(lineText);
	if (blockRef) {
		// Insert before the block reference ID
		// Remove trailing space if exists
		let position = blockRef.index;
		if (position > 0 && lineText[position - 1] === ' ') {
			position--;
		}
		return position;
	}

	// If no block reference, insert at the very end
	return lineText.length;
}

/**
 * Escapes special regex characters
 * @param string The string to escape
 * @returns The escaped string
 */
function escapeRegex(string: string): string {
	return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Detects block reference ID in the text
 * @param text The text to check
 * @returns Object with block reference info or null if not found
 */
function detectBlockReference(text: string): {
	blockId: string;
	index: number;
	length: number;
	fullMatch: string;
} | null {
	// More comprehensive block reference pattern:
	// - Matches ^block-id format
	// - Can have optional whitespace before and after
	// - Block ID can contain letters, numbers, hyphens, and underscores
	// - Must be at the end of the line
	const blockRefPattern = /\s*(\^[a-zA-Z0-9-]+)$/;
	const match = text.match(blockRefPattern);

	if (match && match.index !== undefined) {
		return {
			blockId: match[1],
			index: match.index,
			length: match[0].length,
			fullMatch: match[0]
		};
	}

	return null;
}

/**
 * Removes block reference from text temporarily
 * @param text The text containing block reference
 * @returns Object with cleaned text and block reference info
 */
function extractBlockReference(text: string): {
	cleanedText: string;
	blockRef: ReturnType<typeof detectBlockReference>;
} {
	const blockRef = detectBlockReference(text);

	if (blockRef) {
		const cleanedText = text.substring(0, blockRef.index).trimEnd();
		return {cleanedText, blockRef};
	}

	return {cleanedText: text, blockRef: null};
}

/**
 * Interface for date operations
 */
interface DateOperation {
	type: "add" | "remove";
	dateType: "completed" | "start" | "cancelled";
	format?: string;
}

export {
	handleAutoDateManagerTransaction,
	findTaskStatusChange,
	determineDateOperations,
	getStatusType,
	applyDateOperations,
	isMoveOperation,
	findMetadataInsertPosition,
	findCompletedDateInsertPosition,
};
