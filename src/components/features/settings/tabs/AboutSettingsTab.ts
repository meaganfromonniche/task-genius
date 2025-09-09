import { setIcon, Setting } from "obsidian";
import { TaskProgressBarSettingTab } from "@/setting";
import { t } from "@/translations/helper";
import { OnboardingModal } from "@/components/features/onboarding/OnboardingModal";

export function renderAboutSettingsTab(
	settingTab: TaskProgressBarSettingTab,
	containerEl: HTMLElement
) {
	new Setting(containerEl).setName(t("About") + " Task Genius").setHeading();

	new Setting(containerEl)
		.setName(t("Version"))
		.setDesc(`Task Genius v${settingTab.plugin.manifest.version}`);

	new Setting(containerEl)
		.setName(t("Donate"))
		.setDesc(
			t(
				"If you like this plugin, consider donating to support continued development:"
			)
		)
		.addButton((bt) => {
			bt.buttonEl.outerHTML = `<a href="https://www.buymeacoffee.com/boninall"><img src="https://img.buymeacoffee.com/button-api/?text=Buy me a coffee&emoji=&slug=boninall&button_colour=6495ED&font_colour=ffffff&font_family=Inter&outline_colour=000000&coffee_colour=FFDD00"></a>`;
		});

	new Setting(containerEl)
		.setName(t("Documentation"))
		.setDesc(t("View the documentation for this plugin"))
		.addButton((button) => {
			button.setButtonText(t("Open Documentation")).onClick(() => {
				window.open("https://taskgenius.md/docs/getting-started");
			});
		});

	// Onboarding/Help Section
	new Setting(containerEl)
		.setName(t("Onboarding"))
		.setDesc(t("Restart the welcome guide and setup wizard"))
		.addButton((button) => {
			button
				.setButtonText(t("Restart Onboarding"))
				.setIcon("graduation-cap")
				.onClick(async () => {
					// Reset onboarding status
					await settingTab.plugin.onboardingConfigManager.resetOnboarding();
					
					// Show onboarding modal
					new OnboardingModal(settingTab.plugin.app, settingTab.plugin, () => {
						// Optional: refresh settings display
						settingTab.display();
					}).open();
				});
		});

	new Setting(containerEl)
		.setName(t("Discord"))
		.setDesc(t("Chat with us"))
		.addButton((button) => {
			button.setButtonText(t("Open Discord")).onClick(() => {
				window.open("https://discord.gg/ARR2rHHX6b");
			});
		});

	const descFragment = document.createDocumentFragment();
	descFragment.createEl("span", {
		cls: "tg-icons-desc",
	}, (el) => {
		el.setText(t("Task Genius icons are designed by"))
	});
	descFragment.createEl("a", {
		href: "https://github.com/jsmorabito",
		attr: {
			target: "_blank",
			rel: "noopener noreferrer",
		},
	}, (el) => {
		el.setText(" @Jsmorabito");
	});

	// Task Genius Icons Settings
	new Setting(containerEl)
		.setName(t("Task Genius Icons"))
		.setDesc(descFragment)
		.setHeading();

	containerEl.createDiv({
		cls: "tg-icons-container",
	}, (el) => {
		for(const status of Object.keys(settingTab.plugin.settings.taskStatuses)) {
			const iconEl = el.createSpan();
			setIcon(iconEl, status as "notStarted" | "inProgress" | "completed" | "abandoned" | "planned")
		}
		const tgIconEl = el.createSpan();
		setIcon(tgIconEl, "task-genius")
	})
}
