import { Modal, setIcon, Setting } from "obsidian";
import { t } from "@/translations/helper";
import { allStatusCollections } from "@/common/task-status";
import { TaskProgressBarSettingTab } from "@/setting";
import { getTasksAPI } from "@/utils";
import {
	DEFAULT_SETTINGS,
	TaskStatusConfig,
} from "@/common/setting-definition";
import * as taskStatusModule from "@/common/task-status";

export function renderTaskStatusSettingsTab(
	settingTab: TaskProgressBarSettingTab,
	containerEl: HTMLElement
) {
	new Setting(containerEl)
		.setName(t("Checkbox Status Settings"))
		.setDesc(t("Configure checkbox status settings"))
		.setHeading();

	// Check if Tasks plugin is installed and show compatibility warning
	const tasksAPI = getTasksAPI(settingTab.plugin);
	if (tasksAPI) {
		const warningBanner = containerEl.createDiv({
			cls: "tasks-compatibility-warning",
		});

		warningBanner.createEl("div", {
			cls: "tasks-warning-icon",
			text: "⚠️",
		});

		const warningContent = warningBanner.createDiv({
			cls: "tasks-warning-content",
		});

		warningContent.createEl("div", {
			cls: "tasks-warning-title",
			text: t("Tasks Plugin Detected"),
		});

		const warningText = warningContent.createEl("div", {
			cls: "tasks-warning-text",
		});

		warningText.createEl("span", {
			text: t(
				"Current status management and date management may conflict with the Tasks plugin. Please check the "
			),
		});

		const compatibilityLink = warningText.createEl("a", {
			text: t("compatibility documentation"),
			href: "https://taskgenius.md/docs/compatibility",
		});
		compatibilityLink.setAttribute("target", "_blank");
		compatibilityLink.setAttribute("rel", "noopener noreferrer");

		warningText.createEl("span", {
			text: t(" for more information."),
		});
	}

	new Setting(containerEl)
		.setName(t("Auto complete parent checkbox"))
		.setDesc(
			t(
				"Toggle this to allow this plugin to auto complete parent checkbox when all child tasks are completed."
			)
		)
		.addToggle((toggle) =>
			toggle
				.setValue(settingTab.plugin.settings.autoCompleteParent)
				.onChange(async (value) => {
					settingTab.plugin.settings.autoCompleteParent = value;
					settingTab.applySettingsUpdate();
				})
		);

	new Setting(containerEl)
		.setName(t("Mark parent as 'In Progress' when partially complete"))
		.setDesc(
			t(
				"When some but not all child tasks are completed, mark the parent checkbox as 'In Progress'. Only works when 'Auto complete parent' is enabled."
			)
		)
		.addToggle((toggle) =>
			toggle
				.setValue(
					settingTab.plugin.settings
						.markParentInProgressWhenPartiallyComplete
				)
				.onChange(async (value) => {
					settingTab.plugin.settings.markParentInProgressWhenPartiallyComplete =
						value;
					settingTab.applySettingsUpdate();
				})
		);

	// Checkbox Status Settings
	new Setting(containerEl)
		.setName(t("Checkbox Status Settings"))
		.setDesc(
			t(
				"Select a predefined checkbox status collection or customize your own"
			)
		)
		.setHeading()
		.addDropdown((dropdown) => {
			dropdown.addOption("custom", "Custom");
			for (const statusCollection of allStatusCollections) {
				dropdown.addOption(statusCollection, statusCollection);
			}

			// Set default value to custom
			dropdown.setValue("custom");

			dropdown.onChange(async (value) => {
				if (value === "custom") {
					return;
				}

				// Confirm before applying the theme
				const modal = new Modal(settingTab.app);
				modal.titleEl.setText(`Apply ${value} Theme?`);

				const content = modal.contentEl.createDiv();
				content.setText(
					`This will override your current checkbox status settings with the ${value} theme. Do you want to continue?`
				);

				const buttonContainer = modal.contentEl.createDiv({
					cls: "tg-modal-button-container modal-button-container",
				});

				const cancelButton = buttonContainer.createEl("button");
				cancelButton.setText(t("Cancel"));
				cancelButton.addEventListener("click", () => {
					dropdown.setValue("custom");
					modal.close();
				});

				const confirmButton = buttonContainer.createEl("button");
				confirmButton.setText(t("Apply Theme"));
				confirmButton.addClass("mod-cta");
				confirmButton.addEventListener("click", async () => {
					modal.close();

					// Apply the selected theme's task statuses
					try {
						// Get the function based on the selected theme
						const functionName =
							value.toLowerCase() + "SupportedStatuses";

						// Use type assertion for the dynamic function access
						const getStatuses = (taskStatusModule as any)[
							functionName
						];

						if (typeof getStatuses === "function") {
							const statuses = getStatuses();

							// Update cycle and marks
							const cycle =
								settingTab.plugin.settings.taskStatusCycle;
							const marks =
								settingTab.plugin.settings.taskStatusMarks;
							const excludeMarks =
								settingTab.plugin.settings
									.excludeMarksFromCycle;

							// Clear existing cycle, marks and excludeMarks
							cycle.length = 0;
							Object.keys(marks).forEach(
								(key) => delete marks[key]
							);
							excludeMarks.length = 0;

							// Add new statuses to cycle and marks
							for (const [symbol, name, type] of statuses) {
								const realName = (name as string)
									.split("/")[0]
									.trim();
								// Add to cycle if not already included
								if (!cycle.includes(realName)) {
									cycle.push(realName);
								}

								// Add to marks
								marks[realName] = symbol;

								// Add to excludeMarks if not space or x
								if (symbol !== " " && symbol !== "x") {
									excludeMarks.push(realName);
								}
							}

							// Also update the main taskStatuses object based on the theme
							const statusMap: Record<string, string[]> = {
								completed: [],
								inProgress: [],
								abandoned: [],
								notStarted: [],
								planned: [],
							};
							for (const [symbol, _, type] of statuses) {
								if (type in statusMap) {
									statusMap[
										type as keyof typeof statusMap
									].push(symbol);
								}
							}
							// Corrected loop and assignment for TaskStatusConfig here too
							for (const type of Object.keys(statusMap) as Array<
								keyof TaskStatusConfig
							>) {
								if (
									type in
										settingTab.plugin.settings
											.taskStatuses &&
									statusMap[type] &&
									statusMap[type].length > 0
								) {
									settingTab.plugin.settings.taskStatuses[
										type
									] = statusMap[type].join("|");
								}
							}

							// Save settings and refresh the display
							settingTab.applySettingsUpdate();
							settingTab.display();
						}
					} catch (error) {
						console.error(
							"Failed to apply checkbox status theme:",
							error
						);
					}
				});

				modal.open();
			});
		});

	const completeFragment = createFragment();
	completeFragment.createEl(
		"span",
		{
			cls: "tg-status-icon",
		},
		(el) => {
			setIcon(el, "completed");
		}
	);

	completeFragment.createEl(
		"span",
		{
			cls: "tg-status-text",
		},
		(el) => {
			el.setText(t("Completed"));
		}
	);

	new Setting(containerEl)
		.setName(completeFragment)
		.setDesc(
			t(
				'Characters in square brackets that represent completed tasks. Example: "x|X"'
			)
		)
		.addText((text) =>
			text
				.setPlaceholder(DEFAULT_SETTINGS.taskStatuses.completed)
				.setValue(settingTab.plugin.settings.taskStatuses.completed)
				.onChange(async (value) => {
					settingTab.plugin.settings.taskStatuses.completed =
						value || DEFAULT_SETTINGS.taskStatuses.completed;
					settingTab.applySettingsUpdate();

					// Update Task Genius Icon Manager
					if (settingTab.plugin.taskGeniusIconManager) {
						settingTab.plugin.taskGeniusIconManager.update();
					}
				})
		);

	const plannedFragment = createFragment();
	plannedFragment.createEl(
		"span",
		{
			cls: "tg-status-icon",
		},
		(el) => {
			setIcon(el, "planned");
		}
	);

	plannedFragment.createEl(
		"span",
		{
			cls: "tg-status-text",
		},
		(el) => {
			el.setText(t("Planned"));
		}
	);

	new Setting(containerEl)
		.setName(plannedFragment)
		.setDesc(
			t(
				'Characters in square brackets that represent planned tasks. Example: "?"'
			)
		)
		.addText((text) =>
			text
				.setPlaceholder(DEFAULT_SETTINGS.taskStatuses.planned)
				.setValue(settingTab.plugin.settings.taskStatuses.planned)
				.onChange(async (value) => {
					settingTab.plugin.settings.taskStatuses.planned =
						value || DEFAULT_SETTINGS.taskStatuses.planned;
					settingTab.applySettingsUpdate();

					// Update Task Genius Icon Manager
					if (settingTab.plugin.taskGeniusIconManager) {
						settingTab.plugin.taskGeniusIconManager.update();
					}
				})
		);

	const inProgressFragment = createFragment();
	inProgressFragment.createEl(
		"span",
		{
			cls: "tg-status-icon",
		},
		(el) => {
			setIcon(el, "inProgress");
		}
	);

	inProgressFragment.createEl(
		"span",
		{
			cls: "tg-status-text",
		},
		(el) => {
			el.setText(t("In Progress"));
		}
	);

	new Setting(containerEl)
		.setName(inProgressFragment)
		.setDesc(
			t(
				'Characters in square brackets that represent tasks in progress. Example: ">|/"'
			)
		)
		.addText((text) =>
			text
				.setPlaceholder(DEFAULT_SETTINGS.taskStatuses.inProgress)
				.setValue(settingTab.plugin.settings.taskStatuses.inProgress)
				.onChange(async (value) => {
					settingTab.plugin.settings.taskStatuses.inProgress =
						value || DEFAULT_SETTINGS.taskStatuses.inProgress;
					settingTab.applySettingsUpdate();

					// Update Task Genius Icon Manager
					if (settingTab.plugin.taskGeniusIconManager) {
						settingTab.plugin.taskGeniusIconManager.update();
					}
				})
		);

	const abandonedFragment = createFragment();

	abandonedFragment.createEl(
		"span",
		{
			cls: "tg-status-icon",
		},
		(el) => {
			setIcon(el, "abandoned");
		}
	);

	abandonedFragment.createEl(
		"span",
		{
			cls: "tg-status-text",
		},
		(el) => {
			el.setText(t("Abandoned"));
		}
	);

	new Setting(containerEl)
		.setName(abandonedFragment)
		.setDesc(
			t(
				'Characters in square brackets that represent abandoned tasks. Example: "-"'
			)
		)
		.addText((text) =>
			text
				.setPlaceholder(DEFAULT_SETTINGS.taskStatuses.abandoned)
				.setValue(settingTab.plugin.settings.taskStatuses.abandoned)
				.onChange(async (value) => {
					settingTab.plugin.settings.taskStatuses.abandoned =
						value || DEFAULT_SETTINGS.taskStatuses.abandoned;
					settingTab.applySettingsUpdate();

					// Update Task Genius Icon Manager
					if (settingTab.plugin.taskGeniusIconManager) {
						settingTab.plugin.taskGeniusIconManager.update();
					}
				})
		);

	const notStartedFragment = createFragment();

	notStartedFragment.createEl(
		"span",
		{
			cls: "tg-status-icon",
		},
		(el) => {
			setIcon(el, "notStarted");
		}
	);

	notStartedFragment.createEl(
		"span",
		{
			cls: "tg-status-text",
		},
		(el) => {
			el.setText(t("Not Started"));
		}
	);

	new Setting(containerEl)
		.setName(notStartedFragment)
		.setDesc(
			t(
				'Characters in square brackets that represent not started tasks. Default is space " "'
			)
		)
		.addText((text) =>
			text
				.setPlaceholder(DEFAULT_SETTINGS.taskStatuses.notStarted)
				.setValue(settingTab.plugin.settings.taskStatuses.notStarted)
				.onChange(async (value) => {
					settingTab.plugin.settings.taskStatuses.notStarted =
						value || DEFAULT_SETTINGS.taskStatuses.notStarted;
					settingTab.applySettingsUpdate();

					// Update Task Genius Icon Manager
					if (settingTab.plugin.taskGeniusIconManager) {
						settingTab.plugin.taskGeniusIconManager.update();
					}
				})
		);

	new Setting(containerEl)
		.setName(t("Count other statuses as"))
		.setDesc(
			t(
				'Select the status to count other statuses as. Default is "Not Started".'
			)
		)
		.addDropdown((dropdown) => {
			dropdown.addOption("notStarted", "Not Started");
			dropdown.addOption("abandoned", "Abandoned");
			dropdown.addOption("planned", "Planned");
			dropdown.addOption("completed", "Completed");
			dropdown.addOption("inProgress", "In Progress");
			dropdown.setValue(
				settingTab.plugin.settings.countOtherStatusesAs || "notStarted"
			);
			dropdown.onChange((value) => {
				settingTab.plugin.settings.countOtherStatusesAs = value;
				settingTab.applySettingsUpdate();
			});
		});

	// Task Counting Settings
	new Setting(containerEl)
		.setName(t("Task Counting Settings"))
		.setDesc(t("Configure which task markers to count or exclude"))
		.setHeading();

	new Setting(containerEl)
		.setName(t("Exclude specific task markers"))
		.setDesc(
			t('Specify task markers to exclude from counting. Example: "?|/"')
		)
		.addText((text) =>
			text
				.setPlaceholder("")
				.setValue(settingTab.plugin.settings.excludeTaskMarks)
				.onChange(async (value) => {
					settingTab.plugin.settings.excludeTaskMarks = value;
					settingTab.applySettingsUpdate();
				})
		);

	new Setting(containerEl)
		.setName(t("Only count specific task markers"))
		.setDesc(t("Toggle this to only count specific task markers"))
		.addToggle((toggle) =>
			toggle
				.setValue(settingTab.plugin.settings.useOnlyCountMarks)
				.onChange(async (value) => {
					settingTab.plugin.settings.useOnlyCountMarks = value;
					settingTab.applySettingsUpdate();

					setTimeout(() => {
						settingTab.display();
					}, 200);
				})
		);

	if (settingTab.plugin.settings.useOnlyCountMarks) {
		new Setting(containerEl)
			.setName(t("Specific task markers to count"))
			.setDesc(
				t('Specify which task markers to count. Example: "x|X|>|/"')
			)
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.onlyCountTaskMarks)
					.setValue(settingTab.plugin.settings.onlyCountTaskMarks)
					.onChange(async (value) => {
						if (value.length === 0) {
							settingTab.plugin.settings.onlyCountTaskMarks =
								DEFAULT_SETTINGS.onlyCountTaskMarks;
						} else {
							settingTab.plugin.settings.onlyCountTaskMarks =
								value;
						}
						settingTab.applySettingsUpdate();
					})
			);
	}

	// Check Switcher section
	new Setting(containerEl).setName(t("Checkbox Switcher")).setHeading();

	new Setting(containerEl)
		.setName(t("Enable checkbox status switcher"))
		.setDesc(
			t(
				"Enable/disable the ability to cycle through task states by clicking."
			)
		)
		.addToggle((toggle) => {
			toggle
				.setValue(settingTab.plugin.settings.enableTaskStatusSwitcher)
				.onChange(async (value) => {
					settingTab.plugin.settings.enableTaskStatusSwitcher = value;
					settingTab.applySettingsUpdate();

					setTimeout(() => {
						settingTab.display();
					}, 200);
				});
		});

	if (settingTab.plugin.settings.enableTaskStatusSwitcher) {
		new Setting(containerEl)
			.setName(t("Task mark display style"))
			.setDesc(
				t(
					"Choose how task marks are displayed: default checkboxes, custom text marks, or Task Genius icons."
				)
			)
			.addDropdown((dropdown) => {
				dropdown.addOption("default", t("Default checkboxes"));
				dropdown.addOption("textmarks", t("Custom text marks"));
				dropdown.addOption("icons", t("Task Genius icons"));

				// Determine current value based on existing settings
				let currentValue = "default";
				if (settingTab.plugin.settings.enableTaskGeniusIcons) {
					currentValue = "icons";
				} else if (settingTab.plugin.settings.enableCustomTaskMarks) {
					currentValue = "textmarks";
				}

				dropdown.setValue(currentValue);

				dropdown.onChange(async (value) => {
					// Reset all options first
					settingTab.plugin.settings.enableCustomTaskMarks = false;
					settingTab.plugin.settings.enableTaskGeniusIcons = false;

					// Set the selected option
					if (value === "textmarks") {
						settingTab.plugin.settings.enableCustomTaskMarks = true;
					} else if (value === "icons") {
						settingTab.plugin.settings.enableTaskGeniusIcons = true;
					}

					settingTab.applySettingsUpdate();

					// Update Task Genius Icon Manager
					if (settingTab.plugin.taskGeniusIconManager) {
						settingTab.plugin.taskGeniusIconManager.update();
					}

					// Refresh display to show/hide dependent options
					setTimeout(() => {
						settingTab.display();
					}, 200);
				});
			});

		// Show text mark source mode option only when custom text marks are enabled
		if (settingTab.plugin.settings.enableCustomTaskMarks) {
			new Setting(containerEl)
				.setName(t("Enable text mark in source mode"))
				.setDesc(
					t(
						"Make the text mark in source mode follow the checkbox status cycle when clicked."
					)
				)
				.addToggle((toggle) => {
					toggle
						.setValue(
							settingTab.plugin.settings
								.enableTextMarkInSourceMode
						)
						.onChange(async (value) => {
							settingTab.plugin.settings.enableTextMarkInSourceMode =
								value;
							settingTab.applySettingsUpdate();
						});
				});
		}
	}

	new Setting(containerEl)
		.setName(t("Enable cycle complete status"))
		.setDesc(
			t(
				"Enable/disable the ability to automatically cycle through task states when pressing a mark."
			)
		)
		.addToggle((toggle) => {
			toggle
				.setValue(settingTab.plugin.settings.enableCycleCompleteStatus)
				.onChange(async (value) => {
					settingTab.plugin.settings.enableCycleCompleteStatus =
						value;
					settingTab.applySettingsUpdate();

					setTimeout(() => {
						settingTab.display();
					}, 200);
				});
		});

	if (settingTab.plugin.settings.enableCycleCompleteStatus) {
		new Setting(containerEl)
			.setName(t("Task status cycle and marks"))
			.setDesc(
				t(
					"Define task states and their corresponding marks. The order from top to bottom defines the cycling sequence."
				)
			)
			.addDropdown((dropdown) => {
				dropdown.addOption("custom", "Custom");
				for (const statusCollection of allStatusCollections) {
					dropdown.addOption(statusCollection, statusCollection);
				}

				// Set default value to custom
				dropdown.setValue("custom");

				dropdown.onChange(async (value) => {
					if (value === "custom") {
						return;
					}

					// Confirm before applying the theme
					const modal = new Modal(settingTab.app);
					modal.titleEl.setText(`Apply ${value} Theme?`);

					const content = modal.contentEl.createDiv();
					content.setText(
						t(
							`This will override your current checkbox status settings with the selected theme. Do you want to continue?`
						)
					);

					const buttonContainer = modal.contentEl.createDiv({
						cls: "tg-modal-button-container modal-button-container",
					});

					const cancelButton = buttonContainer.createEl("button");
					cancelButton.setText(t("Cancel"));
					cancelButton.addEventListener("click", () => {
						dropdown.setValue("custom");
						modal.close();
					});

					const confirmButton = buttonContainer.createEl("button");
					confirmButton.setText(t("Apply Theme"));
					confirmButton.addClass("mod-cta");
					confirmButton.addEventListener("click", async () => {
						modal.close();

						// Apply the selected theme's task statuses
						try {
							// Get the function based on the selected theme
							const functionName =
								value.toLowerCase() + "SupportedStatuses";

							// Use type assertion for the dynamic function access
							const getStatuses = (taskStatusModule as any)[
								functionName
							];

							if (typeof getStatuses === "function") {
								const statuses = getStatuses();

								// Update cycle and marks
								const cycle =
									settingTab.plugin.settings.taskStatusCycle;
								const marks =
									settingTab.plugin.settings.taskStatusMarks;
								const excludeMarks =
									settingTab.plugin.settings
										.excludeMarksFromCycle;

								// Clear existing cycle, marks and excludeMarks
								cycle.length = 0;
								Object.keys(marks).forEach(
									(key) => delete marks[key]
								);
								excludeMarks.length = 0;

								// Add new statuses to cycle and marks
								for (const [symbol, name, type] of statuses) {
									const realName = (name as string)
										.split("/")[0]
										.trim();
									// Add to cycle if not already included
									if (!cycle.includes(realName)) {
										cycle.push(realName);
									}

									// Add to marks
									marks[realName] = symbol;

									// Add to excludeMarks if not space or x
									if (symbol !== " " && symbol !== "x") {
										excludeMarks.push(realName);
									}
								}

								// Also update the main taskStatuses object based on the theme
								const statusMap: Record<string, string[]> = {
									completed: [],
									inProgress: [],
									abandoned: [],
									notStarted: [],
									planned: [],
								};
								for (const [symbol, _, type] of statuses) {
									if (type in statusMap) {
										statusMap[
											type as keyof typeof statusMap
										].push(symbol);
									}
								}
								// Corrected loop and assignment for TaskStatusConfig here too
								for (const type of Object.keys(
									statusMap
								) as Array<keyof TaskStatusConfig>) {
									if (
										type in
											settingTab.plugin.settings
												.taskStatuses &&
										statusMap[type] &&
										statusMap[type].length > 0
									) {
										settingTab.plugin.settings.taskStatuses[
											type
										] = statusMap[type].join("|");
									}
								}

								// Save settings and refresh the display
								settingTab.applySettingsUpdate();
								settingTab.display();
							}
						} catch (error) {
							console.error(
								"Failed to apply checkbox status theme:",
								error
							);
						}
					});

					modal.open();
				});
			});

		// Create a container for the task states list
		const taskStatesContainer = containerEl.createDiv({
			cls: "task-states-container",
		});

		// Function to refresh the task states list
		const refreshTaskStatesList = () => {
			// Clear the container
			taskStatesContainer.empty();

			// Get current cycle and marks
			const cycle = settingTab.plugin.settings.taskStatusCycle;
			const marks = settingTab.plugin.settings.taskStatusMarks;

			// Initialize excludeMarksFromCycle if it doesn't exist
			if (!settingTab.plugin.settings.excludeMarksFromCycle) {
				settingTab.plugin.settings.excludeMarksFromCycle = [];
			}

			// Add each status in the cycle
			cycle.forEach((state, index) => {
				const stateRow = taskStatesContainer.createDiv({
					cls: "task-state-row",
				});

				// Create the setting
				const stateSetting = new Setting(stateRow)
					.setName(`Status #${index + 1}`)
					.addText((text) => {
						text.setValue(state)
							.setPlaceholder(t("Status name"))
							.onChange((value) => {
								// Update the state name in both cycle and marks
								const oldState = cycle[index];
								cycle[index] = value;

								// If the old state had a mark, preserve it with the new name
								if (oldState in marks) {
									marks[value] = marks[oldState];
									delete marks[oldState];
								}

								settingTab.applySettingsUpdate();
							});
					})
					.addText((text) => {
						text.setValue(marks[state] || " ")
							.setPlaceholder("Mark")
							.onChange((value) => {
								// Only use the first character
								const mark = value.trim().charAt(0) || " ";
								marks[state] = mark;
								settingTab.applySettingsUpdate();
							});
						text.inputEl.maxLength = 1;
						text.inputEl.style.width = "40px";
					});

				// Add toggle for including in cycle
				stateSetting.addToggle((toggle) => {
					toggle
						.setTooltip(t("Include in cycle"))
						.setValue(
							!settingTab.plugin.settings.excludeMarksFromCycle.includes(
								state
							)
						)
						.onChange((value) => {
							if (!value) {
								// Add to exclude list if not already there
								if (
									!settingTab.plugin.settings.excludeMarksFromCycle.includes(
										state
									)
								) {
									settingTab.plugin.settings.excludeMarksFromCycle.push(
										state
									);
								}
							} else {
								// Remove from exclude list
								settingTab.plugin.settings.excludeMarksFromCycle =
									settingTab.plugin.settings.excludeMarksFromCycle.filter(
										(s) => s !== state
									);
							}
							settingTab.applySettingsUpdate();
						});
				});

				// Add buttons for moving up/down and removing
				stateSetting.addExtraButton((button) => {
					button
						.setIcon("arrow-up")
						.setTooltip(t("Move up"))
						.onClick(() => {
							if (index > 0) {
								// Swap with the previous item
								[cycle[index - 1], cycle[index]] = [
									cycle[index],
									cycle[index - 1],
								];
								settingTab.applySettingsUpdate();
								refreshTaskStatesList();
							}
						});
					button.extraSettingsEl.style.marginRight = "0";
				});

				stateSetting.addExtraButton((button) => {
					button
						.setIcon("arrow-down")
						.setTooltip(t("Move down"))
						.onClick(() => {
							if (index < cycle.length - 1) {
								// Swap with the next item
								[cycle[index], cycle[index + 1]] = [
									cycle[index + 1],
									cycle[index],
								];
								settingTab.applySettingsUpdate();
								refreshTaskStatesList();
							}
						});
					button.extraSettingsEl.style.marginRight = "0";
				});

				stateSetting.addExtraButton((button) => {
					button
						.setIcon("trash")
						.setTooltip(t("Remove"))
						.onClick(() => {
							// Remove from cycle
							cycle.splice(index, 1);
							delete marks[state];
							settingTab.applySettingsUpdate();
							refreshTaskStatesList();
						});
					button.extraSettingsEl.style.marginRight = "0";
				});
			});

			// Add button to add new status
			const addButtonContainer = taskStatesContainer.createDiv();
			new Setting(addButtonContainer).addButton((button) => {
				button
					.setButtonText(t("Add Status"))
					.setCta()
					.onClick(() => {
						// Add a new status to the cycle with a default mark
						const newStatus = `STATUS_${cycle.length + 1}`;
						cycle.push(newStatus);
						marks[newStatus] = " ";
						settingTab.applySettingsUpdate();
						refreshTaskStatesList();
					});
			});
		};

		// Initial render of the task states list
		refreshTaskStatesList();
	}

	// Auto Date Manager Settings
	new Setting(containerEl)
		.setName(t("Auto Date Manager"))
		.setDesc(
			t("Automatically manage dates based on checkbox status changes")
		)
		.setHeading();

	new Setting(containerEl)
		.setName(t("Enable auto date manager"))
		.setDesc(
			t(
				"Toggle this to enable automatic date management when checkbox status changes. Dates will be added/removed based on your preferred metadata format (Tasks emoji format or Dataview format)."
			)
		)
		.addToggle((toggle) =>
			toggle
				.setValue(settingTab.plugin.settings.autoDateManager.enabled)
				.onChange(async (value) => {
					settingTab.plugin.settings.autoDateManager.enabled = value;
					settingTab.applySettingsUpdate();
					setTimeout(() => {
						settingTab.display();
					}, 200);
				})
		);

	if (settingTab.plugin.settings.autoDateManager.enabled) {
		new Setting(containerEl)
			.setName(t("Manage completion dates"))
			.setDesc(
				t(
					"Automatically add completion dates when tasks are marked as completed, and remove them when changed to other statuses."
				)
			)
			.addToggle((toggle) =>
				toggle
					.setValue(
						settingTab.plugin.settings.autoDateManager
							.manageCompletedDate
					)
					.onChange(async (value) => {
						settingTab.plugin.settings.autoDateManager.manageCompletedDate =
							value;
						settingTab.applySettingsUpdate();
					})
			);

		new Setting(containerEl)
			.setName(t("Manage start dates"))
			.setDesc(
				t(
					"Automatically add start dates when tasks are marked as in progress, and remove them when changed to other statuses."
				)
			)
			.addToggle((toggle) =>
				toggle
					.setValue(
						settingTab.plugin.settings.autoDateManager
							.manageStartDate
					)
					.onChange(async (value) => {
						settingTab.plugin.settings.autoDateManager.manageStartDate =
							value;
						settingTab.applySettingsUpdate();
					})
			);

		new Setting(containerEl)
			.setName(t("Manage cancelled dates"))
			.setDesc(
				t(
					"Automatically add cancelled dates when tasks are marked as abandoned, and remove them when changed to other statuses."
				)
			)
			.addToggle((toggle) =>
				toggle
					.setValue(
						settingTab.plugin.settings.autoDateManager
							.manageCancelledDate
					)
					.onChange(async (value) => {
						settingTab.plugin.settings.autoDateManager.manageCancelledDate =
							value;
						settingTab.applySettingsUpdate();
					})
			);
	}
}
