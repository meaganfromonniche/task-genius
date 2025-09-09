import {
	App,
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	TFile,
	setIcon,
	moment,
} from "obsidian";
import { EditorView } from "@codemirror/view";
import { Transaction } from "@codemirror/state";
import TaskProgressBarPlugin from "../../index";
import { t } from "../../translations/helper";

interface SuggestOption {
	id: string;
	label: string;
	icon: string;
	description: string;
	replacement: string;
	trigger?: string;
	action?: (editor: Editor, cursor: EditorPosition, metadata: any) => void;
}

export class QuickCaptureSuggest extends EditorSuggest<SuggestOption> {
	plugin: TaskProgressBarPlugin;
	private isQuickCaptureMode: boolean = false;
	private taskMetadata: any = null;
	private updateButtonState: any = null;
	private dateButton: HTMLButtonElement | null = null;
	private priorityButton: HTMLButtonElement | null = null;
	private tagsButton: HTMLButtonElement | null = null;
	private targetFileUpdater: ((path: string) => void) | null = null;

	constructor(app: App, plugin: TaskProgressBarPlugin) {
		super(app);
		this.plugin = plugin;
	}

	/**
	 * Set the quick capture context
	 */
	setQuickCaptureContext(
		isActive: boolean, 
		metadata?: any, 
		updateButtonState?: any,
		buttons?: {
			dateButton: HTMLButtonElement;
			priorityButton: HTMLButtonElement;
			tagsButton: HTMLButtonElement;
		},
		targetFileUpdater?: (path: string) => void
	): void {
		this.isQuickCaptureMode = isActive;
		this.taskMetadata = metadata;
		this.updateButtonState = updateButtonState;
		if (buttons) {
			this.dateButton = buttons.dateButton;
			this.priorityButton = buttons.priorityButton;
			this.tagsButton = buttons.tagsButton;
		}
		this.targetFileUpdater = targetFileUpdater || null;
	}

	/**
	 * Get the trigger regex for the suggestion
	 */
	onTrigger(
		cursor: EditorPosition,
		editor: Editor,
		file: TFile | null
	): EditorSuggestTriggerInfo | null {
		// Only trigger in quick capture mode
		if (!this.isQuickCaptureMode) {
			return null;
		}

		// Check if we're in a quick capture context
		const editorEl = (editor as any).cm?.dom as HTMLElement;
		if (!editorEl || !editorEl.closest(".quick-capture-panel")) {
			return null;
		}

		// Get the current line
		const line = editor.getLine(cursor.line);
		
		// Define all possible trigger characters
		const allTriggers = ["~", "!", "#", "*", "@"];
		
		// Look backwards from cursor to find a trigger character
		for (let i = cursor.ch - 1; i >= 0; i--) {
			const char = line.charAt(i);
			
			// If we find a trigger character
			if (allTriggers.includes(char)) {
				// Check if there's a space or start of line before it
				if (i === 0 || /\s/.test(line.charAt(i - 1))) {
					// Extract the query text after the trigger
					const query = line.substring(i + 1, cursor.ch);
					
					return {
						start: { line: cursor.line, ch: i },
						end: cursor,
						query: char + query, // Include trigger char and query text
					};
				}
				// If there's no space before the trigger, don't trigger
				break;
			}
			
			// Stop searching if we hit a space or special character (except for valid query chars)
			if (/[\s~!#*@]/.test(char)) {
				break;
			}
		}

		return null;
	}

	/**
	 * Get suggestions based on the trigger
	 */
	getSuggestions(context: EditorSuggestContext): SuggestOption[] {
		// Extract trigger character and search query
		const triggerChar = context.query.charAt(0);
		const searchQuery = context.query.substring(1).toLowerCase();

		let suggestions: SuggestOption[] = [];

		switch (triggerChar) {
			case "~":
				suggestions = this.getDateSuggestions();
				break;
			case "!":
				suggestions = this.getPrioritySuggestions();
				break;
			case "#":
				suggestions = this.getTagSuggestions();
				break;
			case "*":
			case "@":
				suggestions = this.getLocationSuggestions();
				break;
			default:
				return [];
		}

		// Filter suggestions based on search query if present
		if (searchQuery) {
			suggestions = suggestions.filter(s => 
				s.label.toLowerCase().includes(searchQuery) ||
				s.description.toLowerCase().includes(searchQuery)
			);
		}

		return suggestions;
	}

	private getDateSuggestions(): SuggestOption[] {
		return [
			{
				id: "date-today",
				label: t("Today"),
				icon: "calendar",
				description: moment().format("YYYY-MM-DD"),
				replacement: `📅 ${moment().format("YYYY-MM-DD")}`,
				trigger: "~",
				action: (editor, cursor, metadata) => {
					if (this.taskMetadata) {
						this.taskMetadata.dueDate = moment().toDate();
					}
					if (this.updateButtonState && this.dateButton) {
						this.updateButtonState(this.dateButton, true);
					}
				}
			},
			{
				id: "date-tomorrow",
				label: t("Tomorrow"),
				icon: "calendar",
				description: moment().add(1, "day").format("YYYY-MM-DD"),
				replacement: `📅 ${moment().add(1, "day").format("YYYY-MM-DD")}`,
				trigger: "~",
				action: (editor, cursor, metadata) => {
					if (this.taskMetadata) {
						this.taskMetadata.dueDate = moment().add(1, "day").toDate();
					}
					if (this.updateButtonState && this.dateButton) {
						this.updateButtonState(this.dateButton, true);
					}
				}
			},
			{
				id: "date-next-week",
				label: t("Next week"),
				icon: "calendar",
				description: moment().add(1, "week").format("YYYY-MM-DD"),
				replacement: `📅 ${moment().add(1, "week").format("YYYY-MM-DD")}`,
				trigger: "~",
				action: (editor, cursor, metadata) => {
					if (this.taskMetadata) {
						this.taskMetadata.dueDate = moment().add(1, "week").toDate();
					}
					if (this.updateButtonState && this.dateButton) {
						this.updateButtonState(this.dateButton, true);
					}
				}
			},
			{
				id: "date-next-month",
				label: t("Next month"),
				icon: "calendar",
				description: moment().add(1, "month").format("YYYY-MM-DD"),
				replacement: `📅 ${moment().add(1, "month").format("YYYY-MM-DD")}`,
				trigger: "~",
				action: (editor, cursor, metadata) => {
					if (this.taskMetadata) {
						this.taskMetadata.dueDate = moment().add(1, "month").toDate();
					}
					if (this.updateButtonState && this.dateButton) {
						this.updateButtonState(this.dateButton, true);
					}
				}
			}
		];
	}

	private getPrioritySuggestions(): SuggestOption[] {
		return [
			{
				id: "priority-highest",
				label: t("Highest"),
				icon: "arrow-up",
				description: t("🔺 Highest priority"),
				replacement: "🔺",
				trigger: "!",
				action: (editor, cursor, metadata) => {
					if (this.taskMetadata) {
						this.taskMetadata.priority = 5;
					}
					if (this.updateButtonState && this.priorityButton) {
						this.updateButtonState(this.priorityButton, true);
					}
				}
			},
			{
				id: "priority-high",
				label: t("High"),
				icon: "arrow-up",
				description: t("⏫ High priority"),
				replacement: "⏫",
				trigger: "!",
				action: (editor, cursor, metadata) => {
					if (this.taskMetadata) {
						this.taskMetadata.priority = 4;
					}
					if (this.updateButtonState && this.priorityButton) {
						this.updateButtonState(this.priorityButton, true);
					}
				}
			},
			{
				id: "priority-medium",
				label: t("Medium"),
				icon: "minus",
				description: t("🔼 Medium priority"),
				replacement: "🔼",
				trigger: "!",
				action: (editor, cursor, metadata) => {
					if (this.taskMetadata) {
						this.taskMetadata.priority = 3;
					}
					if (this.updateButtonState && this.priorityButton) {
						this.updateButtonState(this.priorityButton, true);
					}
				}
			},
			{
				id: "priority-low",
				label: t("Low"),
				icon: "arrow-down",
				description: t("🔽 Low priority"),
				replacement: "🔽",
				trigger: "!",
				action: (editor, cursor, metadata) => {
					if (this.taskMetadata) {
						this.taskMetadata.priority = 2;
					}
					if (this.updateButtonState && this.priorityButton) {
						this.updateButtonState(this.priorityButton, true);
					}
				}
			},
			{
				id: "priority-lowest",
				label: t("Lowest"),
				icon: "arrow-down",
				description: t("⏬ Lowest priority"),
				replacement: "⏬",
				trigger: "!",
				action: (editor, cursor, metadata) => {
					if (this.taskMetadata) {
						this.taskMetadata.priority = 1;
					}
					if (this.updateButtonState && this.priorityButton) {
						this.updateButtonState(this.priorityButton, true);
					}
				}
			}
		];
	}

	private getTagSuggestions(): SuggestOption[] {
		const commonTags = ["important", "urgent", "todo", "review", "idea", "question", "work", "personal"];
		
		return commonTags.map(tag => ({
			id: `tag-${tag}`,
			label: `#${tag}`,
			icon: "tag",
			description: t(`Add tag: ${tag}`),
			replacement: `#${tag}`,
			trigger: "#",
			action: (editor, cursor, metadata) => {
				if (this.taskMetadata) {
					if (!this.taskMetadata.tags) {
						this.taskMetadata.tags = [];
					}
					if (!this.taskMetadata.tags.includes(tag)) {
						this.taskMetadata.tags.push(tag);
					}
				}
				if (this.updateButtonState && this.tagsButton) {
					this.updateButtonState(this.tagsButton, true);
				}
			}
		}));
	}

	private getLocationSuggestions(): SuggestOption[] {
		const suggestions: SuggestOption[] = [];
		
		// Get the current settings
		const settings = this.plugin.settings.quickCapture;
		const dailyNoteSettings = settings.dailyNoteSettings || {};
		
		// Calculate the daily note path once
		const dateStr = moment().format(dailyNoteSettings.format || "YYYY-MM-DD");
		let dailyNotePath = dateStr + ".md";
		if (dailyNoteSettings.folder && dailyNoteSettings.folder.trim() !== "") {
			// Remove trailing slash if present
			const folder = dailyNoteSettings.folder.replace(/\/$/, "");
			dailyNotePath = `${folder}/${dateStr}.md`;
		}
		
		// Option 1: Fixed file (from settings)
		suggestions.push({
			id: "location-fixed",
			label: t("Fixed File"),
			icon: "file",
			description: settings.targetFile || "Quick Capture.md",
			replacement: "",
			trigger: "*",
			action: (editor, cursor, metadata) => {
				// Always use the current fixed file from settings
				const fixedPath = this.plugin.settings.quickCapture.targetFile || "Quick Capture.md";
				if (this.targetFileUpdater) {
					this.targetFileUpdater(fixedPath);
				}
			}
		});

		// Option 2: Daily Note
		suggestions.push({
			id: "location-daily",
			label: t("Daily Note"),
			icon: "calendar-days",
			description: dailyNotePath,
			replacement: "",
			trigger: "*",
			action: (editor, cursor, metadata) => {
				// Recalculate daily note path to ensure it's current
				const currentSettings = this.plugin.settings.quickCapture.dailyNoteSettings || {};
				const currentDateStr = moment().format(currentSettings.format || "YYYY-MM-DD");
				let currentDailyPath = currentDateStr + ".md";
				if (currentSettings.folder && currentSettings.folder.trim() !== "") {
					const folder = currentSettings.folder.replace(/\/$/, "");
					currentDailyPath = `${folder}/${currentDateStr}.md`;
				}
				
				// Update the selected target path in the panel
				if (this.targetFileUpdater) {
					this.targetFileUpdater(currentDailyPath);
				}
			}
		});

		// Additional quick option: Inbox
		suggestions.push({
			id: "location-inbox",
			label: t("Inbox"),
			icon: "inbox",
			description: t("Save to Inbox.md"),
			replacement: "",
			trigger: "*",
			action: (editor, cursor, metadata) => {
				if (this.targetFileUpdater) {
					this.targetFileUpdater("Inbox.md");
				}
			}
		});

		return suggestions;
	}

	/**
	 * Render suggestion using Obsidian Menu DOM structure
	 */
	renderSuggestion(suggestion: SuggestOption, el: HTMLElement): void {
		el.addClass("menu-item");
		el.addClass("tappable");

		// Create icon element
		const iconEl = el.createDiv("menu-item-icon");
		setIcon(iconEl, suggestion.icon);

		// Create title element
		const titleEl = el.createDiv("menu-item-title");
		titleEl.textContent = suggestion.label;

		// Create description element
		if (suggestion.description) {
			const descEl = el.createDiv("menu-item-description");
			descEl.textContent = suggestion.description;
		}
	}

	/**
	 * Handle suggestion selection
	 */
	selectSuggestion(
		suggestion: SuggestOption,
		evt: MouseEvent | KeyboardEvent
	): void {
		const editor = this.context?.editor;
		const start = this.context?.start;
		const end = this.context?.end;

		if (!editor || !start || !end) return;

		// Replace the entire trigger + query with the replacement text
		const view = (editor as any).cm as EditorView;
		if (!view) {
			// Fallback to old method if view is not available
			editor.replaceRange(suggestion.replacement, start, end);
		} else if (view.state?.doc) {
			// Use CodeMirror 6 changes API
			const startOffset = view.state.doc.line(start.line + 1).from + start.ch;
			const endOffset = view.state.doc.line(end.line + 1).from + end.ch;
			
			view.dispatch({
				changes: {
					from: startOffset,
					to: endOffset,
					insert: suggestion.replacement,
				},
				annotations: [Transaction.userEvent.of("input")],
			});
		}

		// Execute custom action if provided
		if (suggestion.action) {
			suggestion.action(editor, end, this.taskMetadata);
		}

		// Close this suggest
		this.close();
	}
}