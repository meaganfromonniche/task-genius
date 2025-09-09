// Use require for chrono-node to avoid import issues in browser environment
import * as chrono from "chrono-node";
import type {
	TimeComponent,
	EnhancedParsedTimeResult,
	EnhancedTimeExpression,
	EnhancedTimeParsingConfig,
	TimeParsingError,
} from "../types/time-parsing";

export interface ParsedTimeResult {
	startDate?: Date;
	dueDate?: Date;
	scheduledDate?: Date;
	originalText: string;
	cleanedText: string;
	parsedExpressions: Array<{
		text: string;
		date: Date;
		type: "start" | "due" | "scheduled";
		index: number;
		length: number;
	}>;
}

export interface LineParseResult {
	originalLine: string;
	cleanedLine: string;
	startDate?: Date;
	dueDate?: Date;
	scheduledDate?: Date;
	parsedExpressions: Array<{
		text: string;
		date: Date;
		type: "start" | "due" | "scheduled";
		index: number;
		length: number;
	}>;
}

export interface TimeParsingConfig {
	enabled: boolean;
	supportedLanguages: string[];
	dateKeywords: {
		start: string[];
		due: string[];
		scheduled: string[];
	};
	removeOriginalText: boolean;
	perLineProcessing: boolean; // Enable per-line processing instead of global processing
	realTimeReplacement: boolean; // Enable real-time replacement in editor
}

export class TimeParsingService {
	private config: TimeParsingConfig | EnhancedTimeParsingConfig;
	private parseCache: Map<string, ParsedTimeResult | EnhancedParsedTimeResult> = new Map();
	private maxCacheSize: number = 100;
	
	// Time pattern regexes
	private readonly TIME_PATTERNS = {
		// 24-hour format: 12:00, 12:00:00
		TIME_24H: /\b([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\b/g,
		// 12-hour format: 1:30 PM, 1:30:00 PM
		TIME_12H: /\b(1[0-2]|0?[1-9]):([0-5]\d)(?::([0-5]\d))?\s*(AM|PM|am|pm)\b/g,
		// Time range: 12:00-13:00, 12:00~13:00, 12:00 - 13:00
		TIME_RANGE: /\b([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\s*[-~～]\s*([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\b/g,
		// Time range with 12-hour format
		TIME_RANGE_12H: /\b(1[0-2]|0?[1-9]):([0-5]\d)(?::([0-5]\d))?\s*(AM|PM|am|pm)?\s*[-~～]\s*(1[0-2]|0?[1-9]):([0-5]\d)(?::([0-5]\d))?\s*(AM|PM|am|pm)\b/g,
	};

	constructor(config: TimeParsingConfig | EnhancedTimeParsingConfig) {
		this.config = config;
	}

	/**
	 * Parse time components from text (public method for subtask 3.1)
	 * @param text - Text containing time expressions
	 * @returns Object with extracted time components and metadata
	 */
	parseTimeComponents(text: string): {
		timeComponents: EnhancedParsedTimeResult["timeComponents"];
		errors: TimeParsingError[];
		warnings: string[];
	} {
		const errors: TimeParsingError[] = [];
		const warnings: string[] = [];

		try {
			const { timeComponents } = this.extractTimeComponents(text);
			return { timeComponents, errors, warnings };
		} catch (error) {
			const timeError: TimeParsingError = {
				type: "invalid-format",
				originalText: text,
				position: 0,
				message: error instanceof Error ? error.message : "Unknown error during time parsing",
				fallbackUsed: true,
			};
			errors.push(timeError);
			
			return {
				timeComponents: {},
				errors,
				warnings,
			};
		}
	}

	/**
	 * Parse time expressions from a single line and return line-specific result
	 * @param line - Input line containing potential time expressions
	 * @returns LineParseResult with extracted dates and cleaned line
	 */
	parseTimeExpressionsForLine(line: string): LineParseResult {
		const result = this.parseTimeExpressions(line);
		return {
			originalLine: line,
			cleanedLine: result.cleanedText,
			startDate: result.startDate,
			dueDate: result.dueDate,
			scheduledDate: result.scheduledDate,
			parsedExpressions: result.parsedExpressions,
		};
	}

	/**
	 * Parse time expressions from multiple lines and return line-specific results
	 * @param lines - Array of lines containing potential time expressions
	 * @returns Array of LineParseResult with extracted dates and cleaned lines
	 */
	parseTimeExpressionsPerLine(lines: string[]): LineParseResult[] {
		return lines.map((line) => this.parseTimeExpressionsForLine(line));
	}

	/**
	 * Parse time component from text (e.g., "12:00", "1:30 PM")
	 * @param timeText - Time text to parse
	 * @returns TimeComponent or null if invalid
	 */
	private parseTimeComponent(timeText: string): TimeComponent | null {
		// Clean input
		const cleanedText = timeText.trim();
		
		// Try 12-hour format first (more specific)
		const match12h = cleanedText.match(/^(1[0-2]|0?[1-9]):([0-5]\d)(?::([0-5]\d))?\s*(AM|PM|am|pm)$/i);
		if (match12h) {
			let hour = parseInt(match12h[1], 10);
			const minute = parseInt(match12h[2], 10);
			const second = match12h[3] ? parseInt(match12h[3], 10) : undefined;
			const period = match12h[4].toUpperCase();

			// Convert to 24-hour format
			if (period === "PM" && hour !== 12) {
				hour += 12;
			} else if (period === "AM" && hour === 12) {
				hour = 0;
			}

			return {
				hour,
				minute,
				second,
				originalText: cleanedText,
				isRange: false,
			};
		}
		
		// Try 24-hour format
		const match24h = cleanedText.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
		if (match24h) {
			let hour = parseInt(match24h[1], 10);
			const minute = parseInt(match24h[2], 10);
			const second = match24h[3] ? parseInt(match24h[3], 10) : undefined;
			
			// Validate ranges
			if (hour > 23 || minute > 59 || (second !== undefined && second > 59)) {
				return null;
			}
			
			// Handle ambiguous times (e.g., 3:00 could be AM or PM)
			// Note: Only apply defaults when explicitly configured and for truly ambiguous times
			const isEnhancedConfig = (config: any): config is EnhancedTimeParsingConfig => {
				return config && 'timeDefaults' in config;
			};
			
			// Check if this is a user-configured scenario for ambiguous time handling
			// For now, we'll keep 24-hour times as-is unless there's specific context
			
			return {
				hour,
				minute,
				second,
				originalText: cleanedText,
				isRange: false,
			};
		}

		return null;
	}

	/**
	 * Extract time components from text
	 * @param text - Text containing time expressions
	 * @returns Object with extracted time components
	 */
	private extractTimeComponents(text: string): {
		timeComponents: EnhancedParsedTimeResult["timeComponents"];
		timeExpressions: Array<{
			text: string;
			index: number;
			timeComponent?: TimeComponent;
			isRange: boolean;
			rangeStart?: TimeComponent;
			rangeEnd?: TimeComponent;
		}>;
	} {
		const timeComponents: EnhancedParsedTimeResult["timeComponents"] = {};
		const timeExpressions: Array<{
			text: string;
			index: number;
			timeComponent?: TimeComponent;
			isRange: boolean;
			rangeStart?: TimeComponent;
			rangeEnd?: TimeComponent;
		}> = [];

		// Check for time ranges first (they contain single times too)
		const rangeMatches = [...text.matchAll(this.TIME_PATTERNS.TIME_RANGE)];
		const range12hMatches = [...text.matchAll(this.TIME_PATTERNS.TIME_RANGE_12H)];
		
		for (const match of [...rangeMatches, ...range12hMatches]) {
			const fullMatch = match[0];
			const index = match.index || 0;

			// Parse start and end times
			const parts = fullMatch.split(/\s*[-~\uff5e]\s*/);
			if (parts.length === 2) {
				const startTime = this.parseTimeComponent(parts[0]);
				const endTime = this.parseTimeComponent(parts[1]);

				if (startTime && endTime) {
					startTime.isRange = true;
					endTime.isRange = true;
					startTime.rangePartner = endTime;
					endTime.rangePartner = startTime;

					timeExpressions.push({
						text: fullMatch,
						index,
						isRange: true,
						rangeStart: startTime,
						rangeEnd: endTime,
					});

					// Determine context for time range
					const context = this.determineTimeContext(text, fullMatch, index);
					if (context === "start" || !timeComponents.startTime) {
						timeComponents.startTime = startTime;
						timeComponents.endTime = endTime;
					}
				}
			}
		}

		// Check for single times (not part of ranges)
		// Process 12-hour format first (more specific) to avoid conflicts
		const time12hMatches = [...text.matchAll(this.TIME_PATTERNS.TIME_12H)];
		const time24hMatches = [...text.matchAll(this.TIME_PATTERNS.TIME_24H)];

		// Track processed positions to avoid duplicates
		const processedPositions = new Set<number>();

		// Process 12-hour times first
		for (const match of time12hMatches) {
			const fullMatch = match[0];
			const index = match.index || 0;

			// Skip if this time is part of a range we already found
			const isPartOfRange = timeExpressions.some(expr => 
				expr.isRange && 
				index >= expr.index && 
				index < expr.index + expr.text.length
			);

			if (!isPartOfRange) {
				const timeComponent = this.parseTimeComponent(fullMatch);
				if (timeComponent) {
					processedPositions.add(index);
					timeExpressions.push({
						text: fullMatch,
						index,
						timeComponent,
						isRange: false,
					});

					// Determine context and assign to appropriate field
					const context = this.determineTimeContext(text, fullMatch, index);
					switch (context) {
						case "start":
							if (!timeComponents.startTime) timeComponents.startTime = timeComponent;
							break;
						case "due":
							if (!timeComponents.dueTime) timeComponents.dueTime = timeComponent;
							break;
						case "scheduled":
							if (!timeComponents.scheduledTime) timeComponents.scheduledTime = timeComponent;
							break;
					}
				}
			}
		}

		// Process 24-hour times (skip if already processed as 12-hour)
		for (const match of time24hMatches) {
			const fullMatch = match[0];
			const index = match.index || 0;

			// Skip if already processed as 12-hour format
			if (processedPositions.has(index)) {
				continue;
			}

			// Skip if this time is part of a range we already found
			const isPartOfRange = timeExpressions.some(expr => 
				expr.isRange && 
				index >= expr.index && 
				index < expr.index + expr.text.length
			);

			if (!isPartOfRange) {
				const timeComponent = this.parseTimeComponent(fullMatch);
				if (timeComponent) {
					timeExpressions.push({
						text: fullMatch,
						index,
						timeComponent,
						isRange: false,
					});

					// Determine context and assign to appropriate field
					const context = this.determineTimeContext(text, fullMatch, index);
					switch (context) {
						case "start":
							if (!timeComponents.startTime) timeComponents.startTime = timeComponent;
							break;
						case "due":
							if (!timeComponents.dueTime) timeComponents.dueTime = timeComponent;
							break;
						case "scheduled":
							if (!timeComponents.scheduledTime) timeComponents.scheduledTime = timeComponent;
							break;
					}
				}
			}
		}

		return { timeComponents, timeExpressions };
	}

	/**
	 * Determine time context based on surrounding keywords
	 */
	private determineTimeContext(text: string, expression: string, index: number): "start" | "due" | "scheduled" {
		// Get text before the expression (look back up to 20 characters)
		const beforeText = text
			.substring(Math.max(0, index - 20), index)
			.toLowerCase();

		// Get text after the expression (look ahead up to 20 characters)
		const afterText = text
			.substring(
				index + expression.length,
				Math.min(text.length, index + expression.length + 20)
			)
			.toLowerCase();

		// Combine surrounding context
		const context = beforeText + " " + afterText;

		// Check for start keywords first (most specific)
		for (const keyword of this.config.dateKeywords.start) {
			if (context.includes(keyword.toLowerCase())) {
				return "start";
			}
		}

		// Check for scheduled keywords (including "at")
		for (const keyword of this.config.dateKeywords.scheduled) {
			if (context.includes(keyword.toLowerCase())) {
				return "scheduled";
			}
		}

		// Check for due keywords
		for (const keyword of this.config.dateKeywords.due) {
			if (context.includes(keyword.toLowerCase())) {
				return "due";
			}
		}

		// Default based on common patterns
		if (context.includes("at") || context.includes("@")) {
			return "scheduled";
		}

		// Default to due if no specific context found
		return "due";
	}

	/**
	 * Parse time expressions from text and return structured result
	 * @param text - Input text containing potential time expressions
	 * @returns ParsedTimeResult with extracted dates and cleaned text
	 */
	parseTimeExpressions(text: string): ParsedTimeResult | EnhancedParsedTimeResult {
		if (!this.config.enabled) {
			return {
				originalText: text,
				cleanedText: text,
				parsedExpressions: [],
			};
		}

		// Check cache first
		const cacheKey = this.generateCacheKey(text);
		if (this.parseCache.has(cacheKey)) {
			return this.parseCache.get(cacheKey)!;
		}

		// Extract time components first
		const { timeComponents, timeExpressions } = this.extractTimeComponents(text);
		
		// Create enhanced result if time components found
		const result: EnhancedParsedTimeResult = {
			originalText: text,
			cleanedText: text,
			parsedExpressions: [],
			timeComponents: timeComponents,
		};

		try {
			// Validate input
			if (typeof text !== "string") {
				console.warn(
					"TimeParsingService: Invalid input type, expected string"
				);
				return result;
			}

			if (text.trim().length === 0) {
				return result;
			}

			// Parse all date expressions using chrono-node
			// For better Chinese support, we can use specific locale parsers
			const chronoModule = chrono;
			let parseResults;
			try {
				parseResults = chronoModule.parse(text);
			} catch (chronoError) {
				console.warn(
					"TimeParsingService: Chrono parsing failed:",
					chronoError
				);
				parseResults = [];
			}

			// If no results found with default parser and text contains Chinese characters,
			// try with different locale parsers as fallback
			if (parseResults.length === 0 && /[\u4e00-\u9fff]/.test(text)) {
				try {
					// Try Chinese traditional (zh.hant) first if available
					if (
						chronoModule.zh &&
						chronoModule.zh.hant &&
						typeof chronoModule.zh.hant.parse === "function"
					) {
						const zhHantResult = chronoModule.zh.parse(text);
						if (zhHantResult && zhHantResult.length > 0) {
							parseResults = zhHantResult;
						}
					}

					// If still no results, try simplified Chinese (zh) if available
					if (
						parseResults.length === 0 &&
						chronoModule.zh &&
						typeof chronoModule.zh.parse === "function"
					) {
						const zhResult = chronoModule.zh.parse(text);
						if (zhResult && zhResult.length > 0) {
							parseResults = zhResult;
						}
					}

					// If still no results, fallback to custom Chinese parsing
					if (parseResults.length === 0) {
						parseResults = this.parseChineseTimeExpressions(text);
					}
				} catch (chineseParsingError) {
					console.warn(
						"TimeParsingService: Chinese parsing failed:",
						chineseParsingError
					);
					// Fallback to custom Chinese parsing
					try {
						parseResults = this.parseChineseTimeExpressions(text);
					} catch (customParsingError) {
						console.warn(
							"TimeParsingService: Custom Chinese parsing failed:",
							customParsingError
						);
						parseResults = [];
					}
				}
			}

			for (const parseResult of parseResults) {
				try {
					// Validate parse result structure
					if (
						!parseResult ||
						!parseResult.text ||
						!parseResult.start
					) {
						console.warn(
							"TimeParsingService: Invalid parse result structure:",
							parseResult
						);
						continue;
					}

					const expressionText = parseResult.text;
					let date;
					try {
						date = parseResult.start.date();
					} catch (dateError) {
						console.warn(
							"TimeParsingService: Failed to extract date from parse result:",
							dateError
						);
						continue;
					}

					// Validate the extracted date
					if (!date || isNaN(date.getTime())) {
						console.warn(
							"TimeParsingService: Invalid date extracted:",
							date
						);
						continue;
					}

					const index = parseResult.index ?? 0;
					const length = expressionText.length;

					// Determine the type of date based on keywords in the surrounding context
					let type: "start" | "due" | "scheduled";
					try {
						type = this.determineTimeType(
							text,
							expressionText,
							index
						);
					} catch (typeError) {
						console.warn(
							"TimeParsingService: Failed to determine time type:",
							typeError
						);
						type = "due"; // Default fallback
					}

					// Check if this date expression has an associated time component
					let matchingTimeExpr = timeExpressions.find(te => 
						te.index >= index - 10 && te.index <= index + length + 10
					);

					// Check if time range crosses midnight
					let crossesMidnight = false;
					if (matchingTimeExpr?.rangeStart && matchingTimeExpr?.rangeEnd) {
						crossesMidnight = matchingTimeExpr.rangeStart.hour > matchingTimeExpr.rangeEnd.hour;
					}

					const expression: EnhancedTimeExpression = {
						text: expressionText,
						date: date,
						type: type,
						index: index,
						length: length,
						timeComponent: matchingTimeExpr?.timeComponent,
						isTimeRange: matchingTimeExpr?.isRange || false,
						rangeStart: matchingTimeExpr?.rangeStart,
						rangeEnd: matchingTimeExpr?.rangeEnd,
						crossesMidnight: crossesMidnight || undefined,
					};

					result.parsedExpressions.push(expression);

					// Set the appropriate date field based on type
					switch (type) {
						case "start":
							if (!result.startDate) result.startDate = date;
							break;
						case "due":
							if (!result.dueDate) result.dueDate = date;
							break;
						case "scheduled":
							if (!result.scheduledDate)
								result.scheduledDate = date;
							break;
						default:
							console.warn(
								"TimeParsingService: Unknown date type:",
								type
							);
							break;
					}
				} catch (expressionError) {
					console.warn(
						"TimeParsingService: Error processing expression:",
						expressionError
					);
					continue;
				}
			}

			// Clean the text by removing parsed expressions
			result.cleanedText = this.cleanTextFromTimeExpressions(
				text,
				result.parsedExpressions
			);
		} catch (error) {
			console.warn("Time parsing error:", error);
			// Return original text if parsing fails
		} finally {
			// Cache the result for future use
			this.cacheResult(cacheKey, result);
		}

		return result;
	}

	/**
	 * Generate a cache key for the given text and current configuration
	 */
	private generateCacheKey(text: string): string {
		// Include configuration hash to invalidate cache when config changes
		const configHash = JSON.stringify({
			enabled: this.config.enabled,
			removeOriginalText: this.config.removeOriginalText,
			supportedLanguages: this.config.supportedLanguages,
			dateKeywords: this.config.dateKeywords,
		});
		return `${text}|${configHash}`;
	}

	/**
	 * Cache the parsing result with LRU eviction
	 */
	private cacheResult(key: string, result: ParsedTimeResult): void {
		// Implement LRU cache eviction
		if (this.parseCache.size >= this.maxCacheSize) {
			// Remove the oldest entry (first entry in Map)
			const firstKey = this.parseCache.keys().next().value;
			if (firstKey) {
				this.parseCache.delete(firstKey);
			}
		}
		this.parseCache.set(key, result);
	}

	/**
	 * Clear the parsing cache
	 */
	clearCache(): void {
		this.parseCache.clear();
	}

	/**
	 * Clean text by removing parsed time expressions
	 * @param text - Original text
	 * @param expressions - Parsed expressions to remove
	 * @returns Cleaned text
	 */
	cleanTextFromTimeExpressions(
		text: string,
		expressions: ParsedTimeResult["parsedExpressions"]
	): string {
		if (!this.config.removeOriginalText || expressions.length === 0) {
			return text;
		}

		// Sort expressions by index in descending order to remove from end to start
		// This prevents index shifting issues when removing multiple expressions
		const sortedExpressions = [...expressions].sort(
			(a, b) => b.index - a.index
		);

		let cleanedText = text;

		for (const expression of sortedExpressions) {
			const beforeExpression = cleanedText.substring(0, expression.index);
			const afterExpression = cleanedText.substring(
				expression.index + expression.length
			);

			// Check if we need to clean up extra whitespace
			let cleanedBefore = beforeExpression;
			let cleanedAfter = afterExpression;

			// Remove trailing whitespace from before text if the expression is at word boundary
			if (
				beforeExpression.endsWith(" ") &&
				afterExpression.startsWith(" ")
			) {
				cleanedAfter = afterExpression.trimStart();
			} else if (
				beforeExpression.endsWith(" ") &&
				!afterExpression.startsWith(" ")
			) {
				// Keep one space if there's no space after
				cleanedBefore = beforeExpression.trimEnd() + " ";
			}

			// Handle punctuation and spacing around time expressions
			// Case 1: "word, tomorrow, word" -> "word, word"
			// Case 2: "word tomorrow, word" -> "word word"
			// Case 3: "word, tomorrow word" -> "word word"

			// Check for punctuation before the expression
			const beforeHasPunctuation = cleanedBefore.match(/[,;]\s*$/);
			// Check for punctuation after the expression
			const afterHasPunctuation = cleanedAfter.match(/^[,;]\s*/);

			if (beforeHasPunctuation && afterHasPunctuation) {
				// Both sides have punctuation: "word, tomorrow, word" -> "word, word"
				cleanedBefore = cleanedBefore.replace(/[,;]\s*$/, "");
				const punctuation = cleanedAfter.match(/^[,;]/)?.[0] || "";
				cleanedAfter = cleanedAfter.replace(/^[,;]\s*/, "");
				if (cleanedAfter.trim()) {
					cleanedBefore += punctuation + " ";
				}
			} else if (beforeHasPunctuation && !afterHasPunctuation) {
				// Only before has punctuation: "word, tomorrow word" -> "word word"
				cleanedBefore = cleanedBefore.replace(/[,;]\s*$/, "");
				if (cleanedAfter.trim() && !cleanedBefore.endsWith(" ")) {
					cleanedBefore += " ";
				}
			} else if (!beforeHasPunctuation && afterHasPunctuation) {
				// Only after has punctuation: "word tomorrow, word" -> "word word"
				cleanedAfter = cleanedAfter.replace(/^[,;]\s*/, "");
				if (
					cleanedBefore &&
					cleanedAfter.trim() &&
					!cleanedBefore.endsWith(" ")
				) {
					cleanedBefore += " ";
				}
			} else {
				// No punctuation around: "word tomorrow word" -> "word word"
				if (
					cleanedBefore &&
					cleanedAfter.trim() &&
					!cleanedBefore.endsWith(" ")
				) {
					cleanedBefore += " ";
				}
			}

			cleanedText = cleanedBefore + cleanedAfter;
		}

		// Clean up multiple consecutive spaces and tabs, but preserve newlines
		cleanedText = cleanedText.replace(/[ \t]+/g, " ");

		// Only trim whitespace at the very beginning and end, preserving internal newlines
		cleanedText = cleanedText.replace(/^[ \t]+|[ \t]+$/g, "");

		return cleanedText;
	}

	/**
	 * Update parsing configuration
	 * @param config - New configuration
	 */
	updateConfig(config: Partial<TimeParsingConfig>): void {
		this.config = { ...this.config, ...config };
	}

	/**
	 * Get current configuration
	 * @returns Current configuration
	 */
	getConfig(): TimeParsingConfig {
		return { ...this.config };
	}

	/**
	 * Determine the type of time expression based on surrounding context
	 * @param text - Full text
	 * @param expression - Time expression text
	 * @param index - Position of expression in text
	 * @returns Type of time expression
	 */
	private determineTimeType(
		text: string,
		expression: string,
		index: number
	): "start" | "due" | "scheduled" {
		// Get text before the expression (look back up to 20 characters)
		const beforeText = text
			.substring(Math.max(0, index - 20), index)
			.toLowerCase();

		// Get text after the expression (look ahead up to 20 characters)
		const afterText = text
			.substring(
				index + expression.length,
				Math.min(text.length, index + expression.length + 20)
			)
			.toLowerCase();

		// Combine surrounding context
		const context = beforeText + " " + afterText;

		// Check for start keywords
		for (const keyword of this.config.dateKeywords.start) {
			if (context.includes(keyword.toLowerCase())) {
				return "start";
			}
		}

		// Check for due keywords
		for (const keyword of this.config.dateKeywords.due) {
			if (context.includes(keyword.toLowerCase())) {
				return "due";
			}
		}

		// Check for scheduled keywords
		for (const keyword of this.config.dateKeywords.scheduled) {
			if (context.includes(keyword.toLowerCase())) {
				return "scheduled";
			}
		}

		// Default to due date if no specific keywords found
		return "due";
	}

	/**
	 * Parse Chinese time expressions using custom patterns
	 * @param text - Text containing Chinese time expressions
	 * @returns Array of parse results
	 */
	private parseChineseTimeExpressions(text: string): any[] {
		const results: any[] = [];
		const usedIndices = new Set<number>(); // Track used positions to avoid conflicts

		// Common Chinese date patterns - ordered from most specific to most general
		const chinesePatterns = [
			// 下周一, 下周二, ... 下周日 (支持星期和礼拜两种表达) - MUST come before general patterns
			/(?:下|上|这)(?:周|礼拜|星期)(?:一|二|三|四|五|六|日|天)/g,
			// 数字+天后, 数字+周后, 数字+月后
			/(\d+)[天周月]后/g,
			// 数字+天内, 数字+周内, 数字+月内
			/(\d+)[天周月]内/g,
			// 星期一, 星期二, ... 星期日
			/星期(?:一|二|三|四|五|六|日|天)/g,
			// 周一, 周二, ... 周日
			/周(?:一|二|三|四|五|六|日|天)/g,
			// 礼拜一, 礼拜二, ... 礼拜日
			/礼拜(?:一|二|三|四|五|六|日|天)/g,
			// 明天, 后天, 昨天, 前天
			/明天|后天|昨天|前天/g,
			// 下周, 上周, 这周 (general week patterns - MUST come after specific weekday patterns)
			/下周|上周|这周/g,
			// 下个月, 上个月, 这个月
			/下个?月|上个?月|这个?月/g,
			// 明年, 去年, 今年
			/明年|去年|今年/g,
		];

		for (const pattern of chinesePatterns) {
			let match;
			while ((match = pattern.exec(text)) !== null) {
				const matchText = match[0];
				const matchIndex = match.index;
				const matchEnd = matchIndex + matchText.length;

				// Check if this position is already used by a more specific pattern
				let isOverlapping = false;
				for (let i = matchIndex; i < matchEnd; i++) {
					if (usedIndices.has(i)) {
						isOverlapping = true;
						break;
					}
				}

				if (isOverlapping) {
					continue; // Skip this match as it overlaps with a more specific one
				}

				const date = this.parseChineseDate(matchText);

				if (date) {
					// Mark this range as used
					for (let i = matchIndex; i < matchEnd; i++) {
						usedIndices.add(i);
					}

					results.push({
						text: matchText,
						index: matchIndex,
						length: matchText.length,
						start: {
							date: () => date,
						},
					});
				}
			}
		}

		return results;
	}

	/**
	 * Convert Chinese date expression to actual date
	 * @param expression - Chinese date expression
	 * @returns Date object or null
	 */
	private parseChineseDate(expression: string): Date | null {
		const now = new Date();
		const today = new Date(
			now.getFullYear(),
			now.getMonth(),
			now.getDate()
		);

		// Helper function to get weekday number (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
		const getWeekdayNumber = (dayStr: string): number => {
			const dayMap: { [key: string]: number } = {
				日: 0,
				天: 0,
				一: 1,
				二: 2,
				三: 3,
				四: 4,
				五: 5,
				六: 6,
			};
			return dayMap[dayStr] ?? -1;
		};

		// Helper function to get date for specific weekday
		const getDateForWeekday = (
			targetWeekday: number,
			weekOffset: number = 0
		): Date => {
			const currentWeekday = today.getDay();
			let daysToAdd = targetWeekday - currentWeekday;

			// Add week offset
			daysToAdd += weekOffset * 7;

			// If we're looking for the same weekday in current week and it's already passed,
			// move to next week (except for "这周" which should stay in current week)
			if (weekOffset === 0 && daysToAdd <= 0) {
				daysToAdd += 7;
			}

			return new Date(today.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
		};

		// Handle weekday expressions
		const weekdayMatch = expression.match(
			/(?:(下|上|这)?(?:周|礼拜|星期)?)([一二三四五六日天])/
		);
		if (weekdayMatch) {
			const [, weekPrefix, dayStr] = weekdayMatch;
			const targetWeekday = getWeekdayNumber(dayStr);

			if (targetWeekday !== -1) {
				let weekOffset = 0;

				if (weekPrefix === "下") {
					weekOffset = 1; // Next week
				} else if (weekPrefix === "上") {
					weekOffset = -1; // Last week
				} else if (weekPrefix === "这") {
					weekOffset = 0; // This week
				} else {
					// No prefix (like "星期一", "周一", "礼拜一"), assume next occurrence
					weekOffset = 0;
				}

				return getDateForWeekday(targetWeekday, weekOffset);
			}
		}

		switch (expression) {
			case "明天":
				return new Date(today.getTime() + 24 * 60 * 60 * 1000);
			case "后天":
				return new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000);
			case "昨天":
				return new Date(today.getTime() - 24 * 60 * 60 * 1000);
			case "前天":
				return new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000);
			case "下周":
				return new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
			case "上周":
				return new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
			case "这周":
				return today;
			case "下个月":
			case "下月":
				return new Date(
					now.getFullYear(),
					now.getMonth() + 1,
					now.getDate()
				);
			case "上个月":
			case "上月":
				return new Date(
					now.getFullYear(),
					now.getMonth() - 1,
					now.getDate()
				);
			case "这个月":
			case "这月":
				return today;
			case "明年":
				return new Date(
					now.getFullYear() + 1,
					now.getMonth(),
					now.getDate()
				);
			case "去年":
				return new Date(
					now.getFullYear() - 1,
					now.getMonth(),
					now.getDate()
				);
			case "今年":
				return today;
			default:
				// Handle patterns like "3天后", "2周后", "1月后"
				const relativeMatch = expression.match(/(\d+)([天周月])[后内]/);
				if (relativeMatch) {
					const num = parseInt(relativeMatch[1]);
					const unit = relativeMatch[2];

					switch (unit) {
						case "天":
							return new Date(
								today.getTime() + num * 24 * 60 * 60 * 1000
							);
						case "周":
							return new Date(
								today.getTime() + num * 7 * 24 * 60 * 60 * 1000
							);
						case "月":
							return new Date(
								now.getFullYear(),
								now.getMonth() + num,
								now.getDate()
							);
					}
				}
				return null;
		}
	}
}

// Default configuration
export const DEFAULT_TIME_PARSING_CONFIG: TimeParsingConfig & Partial<EnhancedTimeParsingConfig> = {
	enabled: true,
	supportedLanguages: ["en", "zh"],
	dateKeywords: {
		start: [
			"start",
			"begin",
			"from",
			"starting",
			"begins",
			"开始",
			"从",
			"起始",
			"起",
			"始于",
			"自",
		],
		due: [
			"due",
			"deadline",
			"by",
			"until",
			"before",
			"expires",
			"ends",
			"截止",
			"到期",
			"之前",
			"期限",
			"最晚",
			"结束",
			"终止",
			"完成于",
		],
		scheduled: [
			"scheduled",
			"on",
			"at",
			"planned",
			"set for",
			"arranged",
			"安排",
			"计划",
			"在",
			"定于",
			"预定",
			"约定",
			"设定",
		],
	},
	removeOriginalText: true,
	perLineProcessing: true, // Enable per-line processing by default for better multiline support
	realTimeReplacement: false, // Disable real-time replacement by default to avoid interfering with user input
	// Enhanced time parsing configuration
	timePatterns: {
		singleTime: [
			/\b([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\b/,
			/\b(1[0-2]|0?[1-9]):([0-5]\d)(?::([0-5]\d))?\s*(AM|PM|am|pm)\b/,
		],
		timeRange: [
			/\b([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\s*[-~\uff5e]\s*([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\b/,
			/\b(1[0-2]|0?[1-9]):([0-5]\d)(?::([0-5]\d))?\s*(AM|PM|am|pm)?\s*[-~\uff5e]\s*(1[0-2]|0?[1-9]):([0-5]\d)(?::([0-5]\d))?\s*(AM|PM|am|pm)\b/,
		],
		rangeSeparators: ["-", "~", "\uff5e", " - ", " ~ "],
	},
	timeDefaults: {
		preferredFormat: "24h",
		defaultPeriod: "PM",
		midnightCrossing: "next-day",
	},
};
