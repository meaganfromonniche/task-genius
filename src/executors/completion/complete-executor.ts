import { BaseActionExecutor } from "./base-executor";
import {
	OnCompletionConfig,
	OnCompletionExecutionContext,
	OnCompletionExecutionResult,
	OnCompletionActionType,
	OnCompletionCompleteConfig,
} from "../../types/onCompletion";
import { Task } from "../../types/task";

/**
 * Executor for complete action - marks related tasks as completed
 */
export class CompleteActionExecutor extends BaseActionExecutor {
	executeForCanvas(
		context: OnCompletionExecutionContext,
		config: OnCompletionConfig
	): Promise<OnCompletionExecutionResult> {
		return this.execute(context, config);
	}
	executeForMarkdown(
		context: OnCompletionExecutionContext,
		config: OnCompletionConfig
	): Promise<OnCompletionExecutionResult> {
		return this.execute(context, config);
	}
	public async execute(
		context: OnCompletionExecutionContext,
		config: OnCompletionConfig
	): Promise<OnCompletionExecutionResult> {
		if (!this.validateConfig(config)) {
			return this.createErrorResult("Invalid complete configuration");
		}

		return this.executeCommon(context, config);
	}

	private async executeCommon(
		context: OnCompletionExecutionContext,
		config: OnCompletionConfig
	): Promise<OnCompletionExecutionResult> {
		const completeConfig = config as OnCompletionCompleteConfig;
		const { plugin } = context;

		try {
			const completedTasks: string[] = [];
			const failedTasks: string[] = [];

			// Get dataflow query API
			if (!plugin.dataflowOrchestrator) {
				return this.createErrorResult("Dataflow orchestrator not available");
			}
			const queryAPI = plugin.dataflowOrchestrator.getQueryAPI();

			for (const taskId of completeConfig.taskIds) {
				try {
					// Find the task by ID
					const targetTask = await queryAPI.getTaskById(taskId);

					if (!targetTask) {
						failedTasks.push(`Task not found: ${taskId}`);
						continue;
					}

					if (targetTask.completed) {
						// Task is already completed, skip
						continue;
					}

					// Create a completed version of the task
					const updatedTask: Task = {
						...targetTask,
						completed: true,
						status: "x",
						metadata: {
							...targetTask.metadata,
							completedDate: Date.now(),
						},
					};

					// Update the task using WriteAPI
					if (context.plugin.writeAPI) {
						const result = await context.plugin.writeAPI.updateTask({
							taskId: updatedTask.id,
							updates: updatedTask
						});
						if (!result.success) {
							throw new Error(result.error || "Failed to update task");
						}
					} else {
						throw new Error("WriteAPI not available");
					}
					completedTasks.push(taskId);
				} catch (error) {
					failedTasks.push(`${taskId}: ${error.message}`);
				}
			}

			// Build result message
			let message = "";
			if (completedTasks.length > 0) {
				message += `Completed tasks: ${completedTasks.join(", ")}`;
			}
			if (failedTasks.length > 0) {
				if (message) message += "; ";
				message += `Failed: ${failedTasks.join(", ")}`;
			}

			const success = completedTasks.length > 0;
			return success
				? this.createSuccessResult(message)
				: this.createErrorResult(message || "No tasks were completed");
		} catch (error) {
			return this.createErrorResult(
				`Failed to complete related tasks: ${error.message}`
			);
		}
	}

	protected validateConfig(config: OnCompletionConfig): boolean {
		if (config.type !== OnCompletionActionType.COMPLETE) {
			return false;
		}

		const completeConfig = config as OnCompletionCompleteConfig;
		return (
			Array.isArray(completeConfig.taskIds) &&
			completeConfig.taskIds.length > 0
		);
	}

	public getDescription(config: OnCompletionConfig): string {
		const completeConfig = config as OnCompletionCompleteConfig;
		const taskCount = completeConfig.taskIds?.length || 0;
		return `Complete ${taskCount} related task${
			taskCount !== 1 ? "s" : ""
		}`;
	}
}
