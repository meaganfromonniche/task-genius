/**
 * ICS Manager
 * Manages ICS sources, fetching, caching, and synchronization
 */

import { Component, requestUrl, RequestUrlParam } from "obsidian";
import {
	IcsSource,
	IcsEvent,
	IcsFetchResult,
	IcsCacheEntry,
	IcsManagerConfig,
	IcsSyncStatus,
	IcsTask,
	IcsTextReplacement,
	IcsEventWithHoliday,
} from "../types/ics";
import { Task, ExtendedMetadata, EnhancedStandardTaskMetadata } from "../types/task";
import { IcsParser } from "../parsers/ics-parser";
import { HolidayDetector } from "../parsers/holiday-detector";
import { StatusMapper } from "../parsers/ics-status-mapper";
import { WebcalUrlConverter } from "../parsers/webcal-converter";
import { TaskProgressBarSettings } from "../common/setting-definition";
import { TimeParsingService } from "../services/time-parsing-service";
import { TimeComponent } from "../types/time-parsing";
import TaskProgressBarPlugin from "src";

export class IcsManager extends Component {
	private config: IcsManagerConfig;
	private cache: Map<string, IcsCacheEntry> = new Map();
	private syncStatuses: Map<string, IcsSyncStatus> = new Map();
	private refreshIntervals: Map<string, number> = new Map();
	private onEventsUpdated?: (sourceId: string, events: IcsEvent[]) => void;
	private pluginSettings: TaskProgressBarSettings;
	private timeParsingService?: TimeParsingService;

	private plugin?: TaskProgressBarPlugin;

	constructor(
		config: IcsManagerConfig,
		pluginSettings: TaskProgressBarSettings,
		plugin?: TaskProgressBarPlugin,
		timeParsingService?: TimeParsingService,
	) {
		super();
		this.config = config;
		this.pluginSettings = pluginSettings;
		this.plugin = plugin;
		this.timeParsingService = timeParsingService;
	}

	/**
	 * Initialize the ICS manager
	 */
	async initialize(): Promise<void> {
		// Initialize sync statuses for all sources
		for (const source of this.config.sources) {
			this.syncStatuses.set(source.id, {
				sourceId: source.id,
				status: source.enabled ? "idle" : "disabled",
			});
		}

		// Start background refresh if enabled
		if (this.config.enableBackgroundRefresh) {
			this.startBackgroundRefresh();
		}

		console.log("ICS Manager initialized");

		// Notify listeners (e.g., IcsSource) that ICS is ready/config updated
		// try {
		// 	this.plugin.app?.workspace?.trigger?.(
		// 		"task-genius:ics-config-changed",
		// 	);
		// } catch (e) {
		// 	console.warn(
		// 		"[IcsManager] Failed to trigger ics-config-changed on initialize",
		// 		e,
		// 	);
		// }
	}

	/**
	 * Update configuration
	 */
	updateConfig(config: IcsManagerConfig): void {
		this.config = config;

		// Update sync statuses for new/removed sources
		const currentSourceIds = new Set(this.config.sources.map((s) => s.id));

		// Remove statuses for deleted sources
		for (const [sourceId] of this.syncStatuses) {
			if (!currentSourceIds.has(sourceId)) {
				this.syncStatuses.delete(sourceId);
				this.clearRefreshInterval(sourceId);
			}
		}

		// Add statuses for new sources
		for (const source of this.config.sources) {
			if (!this.syncStatuses.has(source.id)) {
				this.syncStatuses.set(source.id, {
					sourceId: source.id,
					status: source.enabled ? "idle" : "disabled",
				});
			}
		}

		// Restart background refresh
		if (this.config.enableBackgroundRefresh) {
			this.startBackgroundRefresh();
		} else {
			this.stopBackgroundRefresh();
		}

		// try {
		// 	this.plugin.app?.workspace?.trigger?.(
		// 		"task-genius:ics-config-changed",
		// 	);
		// } catch (e) {
		// 	console.warn(
		// 		"[IcsManager] Failed to trigger ics-config-changed",
		// 		e,
		// 	);
		// }
	}

	/**
	 * Set event update callback
	 */
	setOnEventsUpdated(
		callback: (sourceId: string, events: IcsEvent[]) => void,
	): void {
		this.onEventsUpdated = callback;
	}

	/**
	 * Get current configuration
	 */
	getConfig(): IcsManagerConfig {
		return this.config;
	}

	/**
	 * Get all events from all enabled sources
	 */
	getAllEvents(): IcsEvent[] {
		const allEvents: IcsEvent[] = [];

		console.log("getAllEvents: cache size", this.cache.size);
		console.log("getAllEvents: config sources", this.config.sources);

		for (const [sourceId, cacheEntry] of this.cache) {
			const source = this.config.sources.find((s) => s.id === sourceId);
			console.log("source", source, "sourceId", sourceId);
			console.log("cacheEntry events count", cacheEntry.events.length);

			if (source?.enabled) {
				console.log("Source is enabled, applying filters");
				// Apply filters if configured
				const filteredEvents = this.applyFilters(
					cacheEntry.events,
					source,
				);
				console.log("filteredEvents count", filteredEvents.length);
				allEvents.push(...filteredEvents);
			} else {
				console.log("Source not enabled or not found", source?.enabled);
			}
		}

		console.log("getAllEvents: total events", allEvents.length);
		return allEvents;
	}

	/**
	 * Get all events with holiday detection and filtering
	 */
	getAllEventsWithHolidayDetection(): IcsEventWithHoliday[] {
		const allEvents: IcsEventWithHoliday[] = [];

		console.log(
			"getAllEventsWithHolidayDetection: cache size",
			this.cache.size,
		);
		console.log(
			"getAllEventsWithHolidayDetection: config sources",
			this.config.sources,
		);

		for (const [sourceId, cacheEntry] of this.cache) {
			const source = this.config.sources.find((s) => s.id === sourceId);

			console.log(
				"Processing source:",
				sourceId,
				"enabled:",
				source?.enabled,
			);
			console.log("Cache entry events count:", cacheEntry.events.length);

			if (source?.enabled) {
				// Apply filters first
				const filteredEvents = this.applyFilters(
					cacheEntry.events,
					source,
				);

				console.log("Filtered events count:", filteredEvents.length);

				// Apply holiday detection if configured
				let processedEvents: IcsEventWithHoliday[];
				if (source.holidayConfig?.enabled) {
					processedEvents =
						HolidayDetector.processEventsWithHolidayDetection(
							filteredEvents,
							source.holidayConfig,
						);
				} else {
					// Convert to IcsEventWithHoliday format without holiday detection
					processedEvents = filteredEvents.map((event) => ({
						...event,
						isHoliday: false,
						showInForecast: true,
					}));
				}

				console.log("Processed events count:", processedEvents.length);
				allEvents.push(...processedEvents);
			}
		}

		console.log(
			"getAllEventsWithHolidayDetection: total events",
			allEvents.length,
		);
		return allEvents;
	}

	private lastSyncTime = 0;
	private readonly SYNC_DEBOUNCE_MS = 30000; // 30 seconds debounce
	private syncPromise: Promise<Map<string, IcsFetchResult>> | null = null;

	/**
	 * Get all events from all enabled sources with forced sync
	 * This will trigger a sync for all enabled sources before returning events
	 * Includes debouncing to prevent excessive syncing and deduplication of concurrent requests
	 */
	async getAllEventsWithSync(): Promise<IcsEvent[]> {
		const now = Date.now();

		// If there's already a sync in progress, wait for it
		if (this.syncPromise) {
			console.log("ICS: Waiting for existing sync to complete");
			await this.syncPromise;
			return this.getAllEvents();
		}

		// Only sync if enough time has passed since last sync
		if (now - this.lastSyncTime > this.SYNC_DEBOUNCE_MS) {
			console.log("ICS: Starting sync (debounced)");
			this.syncPromise = this.syncAllSources().finally(() => {
				this.syncPromise = null;
			});
			await this.syncPromise;
			this.lastSyncTime = now;
		} else {
			console.log("ICS: Skipping sync (debounced)");
		}

		// Return all events after sync
		return this.getAllEvents();
	}

	/**
	 * Get all events from all enabled sources without blocking
	 * This will return cached data immediately and optionally trigger background sync
	 */
	getAllEventsNonBlocking(triggerBackgroundSync: boolean = true): IcsEvent[] {
		const events = this.getAllEvents();

		// Optionally trigger background sync if data might be stale
		if (triggerBackgroundSync) {
			this.triggerBackgroundSyncIfNeeded();
		}

		return events;
	}

	/**
	 * Trigger background sync if needed (non-blocking)
	 */
	private triggerBackgroundSyncIfNeeded(): void {
		const now = Date.now();

		// Check if we need to sync any sources
		const needsSync = this.config.sources.some((source) => {
			if (!source.enabled) return false;

			const cacheEntry = this.cache.get(source.id);
			if (!cacheEntry) return true; // No cache, needs sync

			// Check if cache is expired
			const isExpired = now > cacheEntry.expiresAt;
			return isExpired;
		});

		// Only sync if enough time has passed since last sync and we need it
		if (needsSync && now - this.lastSyncTime > this.SYNC_DEBOUNCE_MS) {
			// Start background sync without waiting
			this.syncAllSources().catch((error) => {
				console.warn("Background ICS sync failed:", error);
			});
		}
	}

	/**
	 * Get events from a specific source
	 */
	getEventsFromSource(sourceId: string): IcsEvent[] {
		const cacheEntry = this.cache.get(sourceId);
		const source = this.config.sources.find((s) => s.id === sourceId);

		if (!cacheEntry || !source?.enabled) {
			return [];
		}

		return this.applyFilters(cacheEntry.events, source);
	}

	/**
	 * Convert ICS events to Task format
	 */
	convertEventsToTasks(events: IcsEvent[]): IcsTask[] {
		return events.map((event) => this.convertEventToTask(event));
	}

	/**
	 * Convert ICS events with holiday detection to Task format
	 */
	convertEventsWithHolidayToTasks(events: IcsEventWithHoliday[]): IcsTask[] {
		return events
			.filter((event) => event.showInForecast) // Filter out events that shouldn't show in forecast
			.map((event) => this.convertEventWithHolidayToTask(event));
	}

	/**
	 * Convert single ICS event to Task format
	 */
	private convertEventToTask(event: IcsEvent): IcsTask {
		// Apply text replacements to the event
		const processedEvent = this.applyTextReplacements(event);

		// Apply status mapping
		const mappedStatus = StatusMapper.applyStatusMapping(
			event,
			event.source.statusMapping,
			this.pluginSettings,
		);

		// Extract time components from event description and preserve original ICS time information
		const enhancedMetadata = this.extractTimeComponentsFromIcsEvent(event, {
			...event,
			...processedEvent,
		});

		const task: IcsTask = {
			id: `ics-${event.source.id}-${event.uid}`,
			content: processedEvent.summary,
			filePath: `ics://${event.source.name}`,
			line: 0,
			completed:
				mappedStatus === "x" ||
				mappedStatus ===
					this.pluginSettings.taskStatusMarks["Completed"],
			status: mappedStatus,
			originalMarkdown: `- [${mappedStatus}] ${processedEvent.summary}`,
			metadata: {
				tags: event.categories || [],
				children: [],
				priority: this.mapIcsPriorityToTaskPriority(event.priority),
				startDate: event.dtstart.getTime(),
				dueDate: event.dtend?.getTime(),
				scheduledDate: event.dtstart.getTime(),
				project: event.source.name,
				context: processedEvent.location,
				heading: [],
				
				// Enhanced time components
				...enhancedMetadata,
			},
			icsEvent: {
				...event,
				summary: processedEvent.summary,
				description: processedEvent.description,
				location: processedEvent.location,
			},
			readonly: true,
			badge: event.source.showType === "badge",
			source: {
				type: "ics",
				name: event.source.name,
				id: event.source.id,
			},
		};

		return task;
	}

	/**
	 * Convert single ICS event with holiday detection to Task format
	 */
	private convertEventWithHolidayToTask(
		event: IcsEventWithHoliday,
	): Task<ExtendedMetadata> & {
		icsEvent: IcsEvent;
		readonly: true;
		badge: boolean;
		source: { type: "ics"; name: string; id: string };
	} {
		// Apply text replacements to the event
		const processedEvent = this.applyTextReplacements(event);

		// Use holiday group title if available and strategy is summary
		let displayTitle = processedEvent.summary;
		if (
			event.holidayGroup &&
			event.holidayGroup.displayStrategy === "summary"
		) {
			displayTitle = event.holidayGroup.title;
		}

		// Apply status mapping
		const mappedStatus = StatusMapper.applyStatusMapping(
			event,
			event.source.statusMapping,
			this.pluginSettings,
		);

		// Extract time components from event description and preserve original ICS time information
		const enhancedMetadata = this.extractTimeComponentsFromIcsEvent(event, {
			...event,
			...processedEvent,
		});

		const task: IcsTask = {
			id: `ics-${event.source.id}-${event.uid}`,
			content: displayTitle,
			filePath: `ics://${event.source.name}`,
			line: 0,
			completed:
				mappedStatus === "x" ||
				mappedStatus ===
					this.pluginSettings.taskStatusMarks["Completed"],
			status: mappedStatus,
			originalMarkdown: `- [${mappedStatus}] ${displayTitle}`,
			metadata: {
				tags: event.categories || [],
				children: [],
				priority: this.mapIcsPriorityToTaskPriority(event.priority),
				startDate: event.dtstart.getTime(),
				dueDate: event.dtend?.getTime(),
				scheduledDate: event.dtstart.getTime(),
				project: event.source.name,
				context: processedEvent.location,
				heading: [],
				
				// Enhanced time components
				...enhancedMetadata,
			} as any, // Use any to allow additional holiday fields
			icsEvent: {
				...event,
				summary: processedEvent.summary,
				description: processedEvent.description,
				location: processedEvent.location,
			},
			readonly: true,
			badge: event.source.showType === "badge",
			source: {
				type: "ics",
				name: event.source.name,
				id: event.source.id,
			},
		};

		return task;
	}

	/**
	 * Extract time components from ICS event and preserve original time information
	 */
	private extractTimeComponentsFromIcsEvent(
		event: IcsEvent,
		processedEvent: IcsEvent
	): Partial<EnhancedStandardTaskMetadata> {
		if (!this.timeParsingService) {
			return {};
		}

		try {
			// Create time components from ICS event times
			const timeComponents: EnhancedStandardTaskMetadata["timeComponents"] = {};

			// Extract time from ICS dtstart (start time)
			if (event.dtstart && !event.allDay) {
				const startTimeComponent = this.createTimeComponentFromDate(event.dtstart);
				if (startTimeComponent) {
					timeComponents.startTime = startTimeComponent;
					timeComponents.scheduledTime = startTimeComponent; // ICS events are typically scheduled
				}
			}

			// Extract time from ICS dtend (end time)
			if (event.dtend && !event.allDay) {
				const endTimeComponent = this.createTimeComponentFromDate(event.dtend);
				if (endTimeComponent) {
					timeComponents.endTime = endTimeComponent;
					timeComponents.dueTime = endTimeComponent; // End time can be considered due time
					
					// Create range relationship if both start and end exist
					if (timeComponents.startTime) {
						timeComponents.startTime.isRange = true;
						timeComponents.startTime.rangePartner = endTimeComponent;
						endTimeComponent.isRange = true;
						endTimeComponent.rangePartner = timeComponents.startTime;
					}
				}
			}

			// Also parse time components from event description and summary if available
			let descriptionTimeComponents: EnhancedStandardTaskMetadata["timeComponents"] = {};
			const textToParse = [processedEvent.summary, processedEvent.description, processedEvent.location]
				.filter(Boolean)
				.join(' ');
			
			if (textToParse.trim()) {
				const { timeComponents: parsedComponents } = this.timeParsingService.parseTimeComponents(textToParse);
				descriptionTimeComponents = parsedComponents;
			}

			// Merge ICS time components with parsed description components
			// ICS times take precedence, but description can provide additional context
			const mergedTimeComponents = {
				...descriptionTimeComponents,
				...timeComponents, // ICS times override description times
			};

			// Create enhanced datetime objects
			const enhancedDates = this.createEnhancedDateTimesFromIcs(event, mergedTimeComponents);

			const enhancedMetadata: Partial<EnhancedStandardTaskMetadata> = {};

			if (Object.keys(mergedTimeComponents).length > 0) {
				enhancedMetadata.timeComponents = mergedTimeComponents;
			}

			if (enhancedDates && Object.keys(enhancedDates).length > 0) {
				enhancedMetadata.enhancedDates = enhancedDates;
			}

			return enhancedMetadata;
		} catch (error) {
			console.error(`[IcsManager] Failed to extract time components from ICS event ${event.uid}:`, error);
			return {};
		}
	}

	/**
	 * Create TimeComponent from Date object
	 */
	private createTimeComponentFromDate(date: Date): TimeComponent | null {
		if (!date || isNaN(date.getTime())) {
			return null;
		}

		// Format time as HH:MM or HH:MM:SS depending on whether seconds are present
		const hours = date.getHours().toString().padStart(2, '0');
		const minutes = date.getMinutes().toString().padStart(2, '0');
		const seconds = date.getSeconds();
		
		let originalText = `${hours}:${minutes}`;
		if (seconds > 0) {
			originalText += `:${seconds.toString().padStart(2, '0')}`;
		}

		return {
			hour: date.getHours(),
			minute: date.getMinutes(),
			second: seconds > 0 ? seconds : undefined,
			originalText,
			isRange: false,
		};
	}

	/**
	 * Create enhanced datetime objects from ICS event and time components
	 */
	private createEnhancedDateTimesFromIcs(
		event: IcsEvent,
		timeComponents: EnhancedStandardTaskMetadata["timeComponents"]
	): EnhancedStandardTaskMetadata["enhancedDates"] {
		const enhancedDates: EnhancedStandardTaskMetadata["enhancedDates"] = {};

		// Use ICS event dates directly as they already contain the correct date and time
		if (event.dtstart) {
			enhancedDates.startDateTime = new Date(event.dtstart);
			enhancedDates.scheduledDateTime = new Date(event.dtstart); // ICS events are typically scheduled
		}

		if (event.dtend) {
			enhancedDates.endDateTime = new Date(event.dtend);
			enhancedDates.dueDateTime = new Date(event.dtend); // End time can be considered due time
		}

		// If we have time components from description parsing but no ICS times (all-day events),
		// try to combine the date from ICS with the parsed time components
		if (event.allDay && timeComponents) {
			const eventDate = new Date(event.dtstart);
			
			if (timeComponents.startTime) {
				const startDateTime = new Date(eventDate);
				startDateTime.setHours(timeComponents.startTime.hour, timeComponents.startTime.minute, timeComponents.startTime.second || 0);
				enhancedDates.startDateTime = startDateTime;
				enhancedDates.scheduledDateTime = startDateTime;
			}
			
			if (timeComponents.endTime) {
				const endDateTime = new Date(eventDate);
				endDateTime.setHours(timeComponents.endTime.hour, timeComponents.endTime.minute, timeComponents.endTime.second || 0);
				
				// Handle midnight crossing for time ranges
				if (timeComponents.startTime && timeComponents.endTime.hour < timeComponents.startTime.hour) {
					endDateTime.setDate(endDateTime.getDate() + 1);
				}
				
				enhancedDates.endDateTime = endDateTime;
				enhancedDates.dueDateTime = endDateTime;
			}
			
			if (timeComponents.dueTime && !enhancedDates.dueDateTime) {
				const dueDateTime = new Date(eventDate);
				dueDateTime.setHours(timeComponents.dueTime.hour, timeComponents.dueTime.minute, timeComponents.dueTime.second || 0);
				enhancedDates.dueDateTime = dueDateTime;
			}
			
			if (timeComponents.scheduledTime && !enhancedDates.scheduledDateTime) {
				const scheduledDateTime = new Date(eventDate);
				scheduledDateTime.setHours(timeComponents.scheduledTime.hour, timeComponents.scheduledTime.minute, timeComponents.scheduledTime.second || 0);
				enhancedDates.scheduledDateTime = scheduledDateTime;
			}
		}

		return Object.keys(enhancedDates).length > 0 ? enhancedDates : undefined;
	}

	/**
	 * Map ICS status to task status
	 */
	private mapIcsStatusToTaskStatus(icsStatus?: string): string {
		switch (icsStatus?.toUpperCase()) {
			case "COMPLETED":
				return "x";
			case "CANCELLED":
				return "-";
			case "TENTATIVE":
				return "?";
			case "CONFIRMED":
			default:
				return " ";
		}
	}

	/**
	 * Map ICS priority to task priority
	 */
	private mapIcsPriorityToTaskPriority(
		icsPriority?: number,
	): number | undefined {
		if (icsPriority === undefined) return undefined;

		// ICS priority: 0 (undefined), 1-4 (high), 5 (normal), 6-9 (low)
		// Task priority: 1 (highest), 2 (high), 3 (medium), 4 (low), 5 (lowest)
		if (icsPriority >= 1 && icsPriority <= 4) return 1; // High
		if (icsPriority === 5) return 3; // Medium
		if (icsPriority >= 6 && icsPriority <= 9) return 5; // Low
		return undefined;
	}

	/**
	 * Manually sync a specific source
	 */
	async syncSource(sourceId: string): Promise<IcsFetchResult> {
		const source = this.config.sources.find((s) => s.id === sourceId);
		if (!source) {
			throw new Error(`Source not found: ${sourceId}`);
		}

		this.updateSyncStatus(sourceId, { status: "syncing" });

		try {
			const result = await this.fetchIcsData(source);

			console.log("syncSource: result", result);

			if (result.success && result.data) {
				// Update cache
				const cacheEntry: IcsCacheEntry = {
					sourceId,
					events: result.data.events,
					timestamp: result.timestamp,
					expiresAt:
						result.timestamp +
						this.config.maxCacheAge * 60 * 60 * 1000,
				};
				this.cache.set(sourceId, cacheEntry);

				// Update sync status
				this.updateSyncStatus(sourceId, {
					status: "idle",
					lastSync: result.timestamp,
					eventCount: result.data.events.length,
				});

				// Notify listeners
				this.onEventsUpdated?.(sourceId, result.data.events);

				// Broadcast workspace event so IcsSource can reload
				// try {
				// 	this.plugin.app?.workspace?.trigger?.(
				// 		"task-genius:ics-cache-updated",
				// 	);
				// } catch (e) {
				// 	console.warn(
				// 		"[IcsManager] Failed to trigger ics-cache-updated",
				// 		e,
				// 	);
				// }
			} else {
				// Handle different types of errors with appropriate logging
				const errorType = this.categorizeError(result.error);
				console.warn(
					`ICS sync failed for source ${sourceId} (${errorType}):`,
					result.error,
				);

				this.updateSyncStatus(sourceId, {
					status: "error",
					error: `${errorType}: ${result.error || "Unknown error"}`,
				});
			}

			return result;
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";
			const errorType = this.categorizeError(errorMessage);

			console.warn(
				`ICS sync exception for source ${sourceId} (${errorType}):`,
				error,
			);

			this.updateSyncStatus(sourceId, {
				status: "error",
				error: `${errorType}: ${errorMessage}`,
			});

			return {
				success: false,
				error: errorMessage,
				timestamp: Date.now(),
			};
		}
	}

	/**
	 * Sync all enabled sources
	 */
	async syncAllSources(): Promise<Map<string, IcsFetchResult>> {
		const results = new Map<string, IcsFetchResult>();

		const syncPromises = this.config.sources
			.filter((source) => source.enabled)
			.map(async (source) => {
				const result = await this.syncSource(source.id);
				results.set(source.id, result);
				return result;
			});

		await Promise.allSettled(syncPromises);
		return results;
	}

	/**
	 * Get sync status for a source
	 */
	getSyncStatus(sourceId: string): IcsSyncStatus | undefined {
		return this.syncStatuses.get(sourceId);
	}

	/**
	 * Get sync statuses for all sources
	 */
	getAllSyncStatuses(): Map<string, IcsSyncStatus> {
		return new Map(this.syncStatuses);
	}

	/**
	 * Clear cache for a specific source
	 */
	clearSourceCache(sourceId: string): void {
		this.cache.delete(sourceId);
	}

	/**
	 * Clear all cache
	 */
	clearAllCache(): void {
		this.cache.clear();
	}

	/**
	 * Fetch ICS data from a source
	 */
	private async fetchIcsData(source: IcsSource): Promise<IcsFetchResult> {
		try {
			// Convert webcal URL if needed
			const conversionResult = WebcalUrlConverter.convertWebcalUrl(
				source.url,
			);

			if (!conversionResult.success) {
				return {
					success: false,
					error: `URL validation failed: ${conversionResult.error}`,
					timestamp: Date.now(),
				};
			}

			const fetchUrl = conversionResult.convertedUrl!;

			const requestParams: RequestUrlParam = {
				url: fetchUrl,
				method: "GET",
				headers: {
					"User-Agent": "Obsidian Task Progress Bar Plugin",
					...source.auth?.headers,
				},
			};

			// Add authentication if configured
			if (source.auth) {
				switch (source.auth.type) {
					case "basic":
						if (source.auth.username && source.auth.password) {
							const credentials = btoa(
								`${source.auth.username}:${source.auth.password}`,
							);
							requestParams.headers!["Authorization"] =
								`Basic ${credentials}`;
						}
						break;
					case "bearer":
						if (source.auth.token) {
							requestParams.headers!["Authorization"] =
								`Bearer ${source.auth.token}`;
						}
						break;
				}
			}

			// Check cache headers
			const cacheEntry = this.cache.get(source.id);
			if (cacheEntry?.etag) {
				requestParams.headers!["If-None-Match"] = cacheEntry.etag;
			}
			if (cacheEntry?.lastModified) {
				requestParams.headers!["If-Modified-Since"] =
					cacheEntry.lastModified;
			}

			// Create timeout promise
			const timeoutMs = this.config.networkTimeout * 1000;
			const timeoutPromise = new Promise<never>((_, reject) => {
				setTimeout(() => {
					reject(
						new Error(
							`Request timeout after ${this.config.networkTimeout} seconds`,
						),
					);
				}, timeoutMs);
			});

			// Race between request and timeout
			const response = await Promise.race([
				requestUrl(requestParams),
				timeoutPromise,
			]);

			// Handle 304 Not Modified
			if (response.status === 304 && cacheEntry) {
				return {
					success: true,
					data: {
						events: cacheEntry.events,
						errors: [],
						metadata: {},
					},
					timestamp: Date.now(),
				};
			}

			if (response.status !== 200) {
				return {
					success: false,
					error: `HTTP ${response.status}: ${
						response.text || "Unknown error"
					}`,
					statusCode: response.status,
					timestamp: Date.now(),
				};
			}

			// Parse ICS content
			const parseResult = IcsParser.parse(response.text, source);

			// Update cache with HTTP headers
			if (cacheEntry) {
				cacheEntry.etag = response.headers["etag"];
				cacheEntry.lastModified = response.headers["last-modified"];
			}

			return {
				success: true,
				data: parseResult,
				timestamp: Date.now(),
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
				timestamp: Date.now(),
			};
		}
	}

	/**
	 * Apply filters to events
	 */
	private applyFilters(events: IcsEvent[], source: IcsSource): IcsEvent[] {
		let filteredEvents = [...events];
		console.log("applyFilters: initial events count", events.length);
		console.log("applyFilters: source config", {
			showAllDayEvents: source.showAllDayEvents,
			showTimedEvents: source.showTimedEvents,
			filters: source.filters,
		});

		// Apply event type filters
		if (!source.showAllDayEvents) {
			const beforeFilter = filteredEvents.length;
			filteredEvents = filteredEvents.filter((event) => !event.allDay);
			console.log(
				`Filtered out all-day events: ${beforeFilter} -> ${filteredEvents.length}`,
			);
		}
		if (!source.showTimedEvents) {
			const beforeFilter = filteredEvents.length;
			filteredEvents = filteredEvents.filter((event) => event.allDay);
			console.log(
				`Filtered out timed events: ${beforeFilter} -> ${filteredEvents.length}`,
			);
		}

		// Apply custom filters
		if (source.filters) {
			filteredEvents = filteredEvents.filter((event) => {
				// Include filters
				if (source.filters!.include) {
					const include = source.filters!.include;
					let shouldInclude = true;

					if (include.summary?.length) {
						shouldInclude =
							shouldInclude &&
							include.summary.some((pattern) =>
								this.matchesPattern(event.summary, pattern),
							);
					}
					if (include.description?.length && event.description) {
						shouldInclude =
							shouldInclude &&
							include.description.some((pattern) =>
								this.matchesPattern(
									event.description!,
									pattern,
								),
							);
					}
					if (include.location?.length && event.location) {
						shouldInclude =
							shouldInclude &&
							include.location.some((pattern) =>
								this.matchesPattern(event.location!, pattern),
							);
					}
					if (include.categories?.length && event.categories) {
						shouldInclude =
							shouldInclude &&
							include.categories.some((category) =>
								event.categories!.includes(category),
							);
					}

					if (!shouldInclude) return false;
				}

				// Exclude filters
				if (source.filters!.exclude) {
					const exclude = source.filters!.exclude;

					if (exclude.summary?.length) {
						if (
							exclude.summary.some((pattern) =>
								this.matchesPattern(event.summary, pattern),
							)
						) {
							return false;
						}
					}
					if (exclude.description?.length && event.description) {
						if (
							exclude.description.some((pattern) =>
								this.matchesPattern(
									event.description!,
									pattern,
								),
							)
						) {
							return false;
						}
					}
					if (exclude.location?.length && event.location) {
						if (
							exclude.location.some((pattern) =>
								this.matchesPattern(event.location!, pattern),
							)
						) {
							return false;
						}
					}
					if (exclude.categories?.length && event.categories) {
						if (
							exclude.categories.some((category) =>
								event.categories!.includes(category),
							)
						) {
							return false;
						}
					}
				}

				return true;
			});
		}

		// Limit number of events
		if (filteredEvents.length > this.config.maxEventsPerSource) {
			const beforeLimit = filteredEvents.length;
			filteredEvents = filteredEvents
				.sort((a, b) => b.dtstart.getTime() - a.dtstart.getTime()) // 倒序：最新的事件在前
				.slice(0, this.config.maxEventsPerSource);
			console.log(
				`Limited events: ${beforeLimit} -> ${filteredEvents.length} (max: ${this.config.maxEventsPerSource}) - keeping newest events`,
			);
		}

		console.log("applyFilters: final events count", filteredEvents.length);
		return filteredEvents;
	}

	/**
	 * Check if text matches a pattern (supports regex)
	 */
	private matchesPattern(text: string, pattern: string): boolean {
		try {
			// Try to use as regex first
			const regex = new RegExp(pattern, "i");
			return regex.test(text);
		} catch {
			// Fall back to simple string matching
			return text.toLowerCase().includes(pattern.toLowerCase());
		}
	}

	/**
	 * Apply text replacement rules to an ICS event
	 */
	private applyTextReplacements(event: IcsEvent): {
		summary: string;
		description?: string;
		location?: string;
	} {
		const source = event.source;
		const replacements = source.textReplacements;

		// If no replacements configured, return original values
		if (!replacements || replacements.length === 0) {
			return {
				summary: event.summary,
				description: event.description,
				location: event.location,
			};
		}

		let processedSummary = event.summary;
		let processedDescription = event.description;
		let processedLocation = event.location;

		// Apply each enabled replacement rule
		for (const rule of replacements) {
			if (!rule.enabled) {
				continue;
			}

			try {
				const regex = new RegExp(rule.pattern, rule.flags || "g");

				// Apply to specific target or all fields
				switch (rule.target) {
					case "summary":
						processedSummary = processedSummary.replace(
							regex,
							rule.replacement,
						);
						break;
					case "description":
						if (processedDescription) {
							processedDescription = processedDescription.replace(
								regex,
								rule.replacement,
							);
						}
						break;
					case "location":
						if (processedLocation) {
							processedLocation = processedLocation.replace(
								regex,
								rule.replacement,
							);
						}
						break;
					case "all":
						processedSummary = processedSummary.replace(
							regex,
							rule.replacement,
						);
						if (processedDescription) {
							processedDescription = processedDescription.replace(
								regex,
								rule.replacement,
							);
						}
						if (processedLocation) {
							processedLocation = processedLocation.replace(
								regex,
								rule.replacement,
							);
						}
						break;
				}
			} catch (error) {
				console.warn(
					`Invalid regex pattern in text replacement rule "${rule.name}": ${rule.pattern}`,
					error,
				);
			}
		}

		return {
			summary: processedSummary,
			description: processedDescription,
			location: processedLocation,
		};
	}

	/**
	 * Update sync status
	 */
	private updateSyncStatus(
		sourceId: string,
		updates: Partial<IcsSyncStatus>,
	): void {
		const current = this.syncStatuses.get(sourceId) || {
			sourceId,
			status: "idle",
		};
		this.syncStatuses.set(sourceId, { ...current, ...updates });
	}

	/**
	 * Categorize error types for better handling
	 */
	private categorizeError(errorMessage?: string): string {
		if (!errorMessage) return "unknown";

		const message = errorMessage.toLowerCase();

		if (
			message.includes("timeout") ||
			message.includes("request timeout")
		) {
			return "timeout";
		}
		if (
			message.includes("connection") ||
			message.includes("network") ||
			message.includes("err_connection")
		) {
			return "network";
		}
		if (message.includes("404") || message.includes("not found")) {
			return "not-found";
		}
		if (
			message.includes("403") ||
			message.includes("unauthorized") ||
			message.includes("401")
		) {
			return "auth";
		}
		if (
			message.includes("500") ||
			message.includes("502") ||
			message.includes("503")
		) {
			return "server";
		}
		if (message.includes("parse") || message.includes("invalid")) {
			return "parse";
		}

		return "unknown";
	}

	/**
	 * Start background refresh for all sources
	 */
	private startBackgroundRefresh(): void {
		this.stopBackgroundRefresh(); // Clear existing intervals

		for (const source of this.config.sources) {
			if (source.enabled) {
				const interval =
					source.refreshInterval || this.config.globalRefreshInterval;
				const intervalId = setInterval(
					() => {
						this.syncSource(source.id).catch((error) => {
							console.error(
								`Background sync failed for source ${source.id}:`,
								error,
							);
						});
					},
					interval * 60 * 1000,
				); // Convert minutes to milliseconds

				this.refreshIntervals.set(source.id, intervalId as any);
			}
		}
	}

	/**
	 * Stop background refresh
	 */
	private stopBackgroundRefresh(): void {
		for (const [sourceId, intervalId] of this.refreshIntervals) {
			clearInterval(intervalId);
		}
		this.refreshIntervals.clear();
	}

	/**
	 * Clear refresh interval for a specific source
	 */
	private clearRefreshInterval(sourceId: string): void {
		const intervalId = this.refreshIntervals.get(sourceId);
		if (intervalId) {
			clearInterval(intervalId);
			this.refreshIntervals.delete(sourceId);
		}
	}

	/**
	 * Cleanup when component is unloaded
	 */
	override onunload(): void {
		this.stopBackgroundRefresh();
		super.onunload();
	}
}
