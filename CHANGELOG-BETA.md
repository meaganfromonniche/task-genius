# Beta Changelog

All notable changes to beta releases will be documented in this file.



## [9.8.0-beta.15](https://github.com/Quorafind/Obsidian-Task-Genius/compare/9.8.0-beta.14...9.8.0-beta.15) (2025-09-03)

### Features

* **quick-capture:** add electron-based quick capture window ([ae80f14](https://github.com/Quorafind/Obsidian-Task-Genius/commit/ae80f14fde8c5e06f3f96b7c890dd3a5201b51ad))
* **quick-capture:** add start and scheduled date fields to electron quick capture ([cbfb2fc](https://github.com/Quorafind/Obsidian-Task-Genius/commit/cbfb2fc8729914843f9e76cbfccd3963b9ee6af5))
* **tasks:** add task deletion with cascade support ([1cec2cc](https://github.com/Quorafind/Obsidian-Task-Genius/commit/1cec2cce41bec7ec6468cc567cb6760fe32950b9))

## [9.8.0-beta.14](https://github.com/Quorafind/Obsidian-Task-Genius/compare/9.8.0-beta.13...9.8.0-beta.14) (2025-09-03)

### Bug Fixes

* **parser:** respect custom project/context/area prefixes in task parsing ([527cb36](https://github.com/Quorafind/Obsidian-Task-Genius/commit/527cb36243c99c0d7bab3da5ee446f075502a8d0)), closes [#422](https://github.com/Quorafind/Obsidian-Task-Genius/issues/422)

## [9.8.0-beta.13](https://github.com/Quorafind/Obsidian-Task-Progress-Bar/compare/9.8.0-beta.12...9.8.0-beta.13) (2025-09-02)

### Features

* **parser:** add case-insensitive tag prefix matching ([6e20a7a](https://github.com/Quorafind/Obsidian-Task-Progress-Bar/commit/6e20a7a87947a7f47b2e8f7a51d0891e7071f049))

### Bug Fixes

* **dates:** apply timezone handling to InlineEditor and TaskPropertyTwoColumnView ([77d21e4](https://github.com/Quorafind/Obsidian-Task-Progress-Bar/commit/77d21e461160d67dac08437d40abd73f8dda92d8))
* **dates:** correct timezone handling for date display in task views ([f1a3c10](https://github.com/Quorafind/Obsidian-Task-Progress-Bar/commit/f1a3c10bcbf29e035bb7a6d8da14436c3039689a)), closes [#419](https://github.com/Quorafind/Obsidian-Task-Progress-Bar/issues/419)

## [9.8.0-beta.12](https://github.com/Quorafind/Obsidian-Task-Progress-Bar/compare/9.8.0-beta.11...9.8.0-beta.12) (2025-09-01)

### Features

* **habits:** improve habit property handling and add reindex command ([40bb407](https://github.com/Quorafind/Obsidian-Task-Progress-Bar/commit/40bb407f5da981aa6d366fa7f87b3cabb3d986ea))

### Bug Fixes

* **habits:** improve habit sync and progress visualization ([d18267c](https://github.com/Quorafind/Obsidian-Task-Progress-Bar/commit/d18267c09549c9d2a16010e2bfbcfb45e84c81d9))
* improve task regex to prevent matching nested brackets in status ([26cd602](https://github.com/Quorafind/Obsidian-Task-Progress-Bar/commit/26cd6028b889da23bdcb3a85f44c24ed3ba1d039))

### Refactors

* rename DesktopIntegrationManager file to kebab-case and add multi-instance support ([bd4623f](https://github.com/Quorafind/Obsidian-Task-Progress-Bar/commit/bd4623f409182d13049ff150314bf3d605d6e9a7))
* **settings:** replace custom list UI with ListConfigModal and use native debounce ([a6d94a5](https://github.com/Quorafind/Obsidian-Task-Progress-Bar/commit/a6d94a5d7e9daad3cfe36de3a03ce238858ec00f))

## [9.8.0-beta.11](https://github.com/Quorafind/Obsidian-Task-Progress-Bar/compare/9.8.0-beta.10...9.8.0-beta.11) (2025-08-31)

### Bug Fixes

* **tray:** improve icon visibility and window focus behavior ([a5aedad](https://github.com/Quorafind/Obsidian-Task-Progress-Bar/commit/a5aedadf4470c479562d9b2047dabd2ef7355496))

## [9.8.0-beta.10](https://github.com/Quorafind/Obsidian-Task-Genius/compare/9.8.0-beta.9...9.8.0-beta.10) (2025-08-30)

### Features

* **settings:** improve heading filter UI and fix matching logic ([1e20055](https://github.com/Quorafind/Obsidian-Task-Genius/commit/1e2005590360a8ee78037a2a46a5eb3152feb6a0))

### Styles

* fix indentation and improve configuration passing ([fbb9417](https://github.com/Quorafind/Obsidian-Task-Genius/commit/fbb9417f63397e71163e60be0c1fed4636ac6136))

## [9.8.0-beta.9](https://github.com/Quorafind/Obsidian-Task-Genius/compare/9.8.0-beta.8...9.8.0-beta.9) (2025-08-30)

### Features

* **notifications:** add desktop notifications and tray menu integration ([06b162a](https://github.com/Quorafind/Obsidian-Task-Genius/commit/06b162a628bf4fce4c0d4982b8a08eab4b744247))
* **notifications:** add flexible tray modes and improve task filtering ([9d65bd5](https://github.com/Quorafind/Obsidian-Task-Genius/commit/9d65bd566d54a0d88820de4e2766d6c1f6f2ce21))
* **settings:** improve input fields with native HTML5 types ([e617890](https://github.com/Quorafind/Obsidian-Task-Genius/commit/e617890ae1f4999c7920b01b0ff6aa9e4e7ab738))
* **tray:** add theme-aware Task Genius icon for system tray ([6faded9](https://github.com/Quorafind/Obsidian-Task-Genius/commit/6faded94847bff8386838e787b443da788ef7672))

### Bug Fixes

* **dataflow:** correct event cleanup in DataflowOrchestrator ([0401a63](https://github.com/Quorafind/Obsidian-Task-Genius/commit/0401a634e10fb57071cca2979406c9beef4a0a16))
* resolve memory leaks by adding proper cleanup handlers ([2d85f38](https://github.com/Quorafind/Obsidian-Task-Genius/commit/2d85f38750377619c473a5dd32c1c90e41d824c4))
* **tray:** add cleanup handler for hard reloads and improve electron API access ([29e000c](https://github.com/Quorafind/Obsidian-Task-Genius/commit/29e000c334905a3104c40d390ede1656dd156f56))

### Styles

* apply code formatting and linting updates ([d43186f](https://github.com/Quorafind/Obsidian-Task-Genius/commit/d43186fef7a595248773a70d3fc28d56518f71e8))

## [9.8.0-beta.8](https://github.com/Quorafind/Obsidian-Task-Genius/compare/9.8.0-beta.7...9.8.0-beta.8) (2025-08-28)

### Refactors

* **build:** migrate to TypeScript path aliases and update esbuild to v0.25.9 ([77dd5f5](https://github.com/Quorafind/Obsidian-Task-Genius/commit/77dd5f5da5513e65939d85914e58a3e69122012a))
* complete component directory migration with all direct imports fixed ([798403e](https://github.com/Quorafind/Obsidian-Task-Genius/commit/798403e5a48ae6c3d646b32112a8234aeef65e74))
* **components:** add barrel exports for ui modules (phase 4) ([a009352](https://github.com/Quorafind/Obsidian-Task-Genius/commit/a0093526f763c95c0c1ce569604fa10e76cc5153))
* **components:** add missing re-exports for backward compatibility (phase 5) ([a720293](https://github.com/Quorafind/Obsidian-Task-Genius/commit/a720293cb6becbf3eefe569bcaaafc3c3b42515a))
* **components:** consolidate feature modules under src/components/features/* with transitional re-exports (phase 2) ([b9ace94](https://github.com/Quorafind/Obsidian-Task-Genius/commit/b9ace948c92f51adff0a2163444134dc50338d1c))
* **components:** extract shared UI into src/components/ui/* with transitional re-exports (phase 1) ([88bcca4](https://github.com/Quorafind/Obsidian-Task-Genius/commit/88bcca4278699795f336e48fd311412c0bad78a1))
* remove duplicate re-export files and update all imports to point directly to new locations ([a7667b1](https://github.com/Quorafind/Obsidian-Task-Genius/commit/a7667b155001fdb7a027365539afaf3b00c54d84))
* **settings:** standardize settings under features/settings with tabs/components/core structure (phase 3) ([28efa41](https://github.com/Quorafind/Obsidian-Task-Genius/commit/28efa411459bc908ce2f626860c82a0149179b58))

### Chores

* remove temporary migration scripts ([e551a6b](https://github.com/Quorafind/Obsidian-Task-Genius/commit/e551a6b9eb49f2fcff6f2348f4feacc29e09681f))

## [9.8.0-beta.7](https://github.com/Quorafind/Obsidian-Task-Genius/compare/9.8.0-beta.6...9.8.0-beta.7) (2025-08-28)

### Bug Fixes

* **renderer:** remove priority emojis from markdown content regardless of position ([ba52d97](https://github.com/Quorafind/Obsidian-Task-Genius/commit/ba52d97fd41272a1323df05a942cd242ec40f4c3))

### Styles

* **task-list:** improve multi-line content layout flexibility ([bd56cd6](https://github.com/Quorafind/Obsidian-Task-Genius/commit/bd56cd66f2459102f06cdcebc86a9715a3b5b2a2))

## [9.8.0-beta.6](https://github.com/Quorafind/Obsidian-Task-Genius/compare/9.8.0-beta.5...9.8.0-beta.6) (2025-08-27)

### Features

* **modal:** add external link button to IframeModal header ([5511203](https://github.com/Quorafind/Obsidian-Task-Genius/commit/5511203be77fa60af0a8c8781cf0706bc456f305))
* **settings:** add bases-support URL and improve modal styling ([b10a757](https://github.com/Quorafind/Obsidian-Task-Genius/commit/b10a75700194da8e57c096058defa279ad33b07b))

## [9.8.0-beta.5](https://github.com/Quorafind/Obsidian-Task-Genius/compare/9.8.0-beta.4...9.8.0-beta.5) (2025-08-27)

### Refactors

* **settings:** restructure beta features into dedicated tabs ([b0431ce](https://github.com/Quorafind/Obsidian-Task-Genius/commit/b0431ce8a99e4d0fce2a9ef49c0878957d5ecd73))

### Chores

* **docs:** update changelog-beta documentation ([e3ba531](https://github.com/Quorafind/Obsidian-Task-Genius/commit/e3ba531c04913878ba1800c7a9858129517e4b20))

## [9.8.0-beta.4](https://github.com/Quorafind/Obsidian-Task-Genius/compare/9.8.0-beta.3...9.8.0-beta.4) (2025-08-27)

### Refactors

* **quadrant:** replace custom feedback elements with Obsidian Notice API ([b2b4ce9](https://github.com/Quorafind/Obsidian-Task-Genius/commit/b2b4ce99fcb634b24921db034a62ebc18bfc9b7d))

## [9.8.0-beta.3](https://github.com/Quorafind/Obsidian-Task-Genius/compare/9.8.0-beta.2...9.8.0-beta.3) (2025-08-27)

### Bug Fixes

* **task-view:** resolve task sorting instability and scroll jumping ([ac54fdb](https://github.com/Quorafind/Obsidian-Task-Genius/commit/ac54fdb0bb6248bf34772dd420e954bd33a3656d))

### Refactors

* **settings:** consolidate dataflowEnabled into enableIndexer ([e599302](https://github.com/Quorafind/Obsidian-Task-Genius/commit/e599302be2a07bc1d65fb79aaa761c738f88cc71))

### Chores

* **task-view:** remove debug console.log and comment ([cfb9b03](https://github.com/Quorafind/Obsidian-Task-Genius/commit/cfb9b03c64e9a8e3e0c7e94e496f3cf1fca665b8))

## [9.8.0-beta.2](https://github.com/Quorafind/Obsidian-Task-Genius/compare/v9.8.0-beta.0-9-g134bfb8dc2f4f28ac7ecde4e4df3442c193ad46f...9.8.0-beta.2) (2025-08-27)

### Bug Fixes

* **date:** date and priority issue when using inline editor update content ([f6a82d3](https://github.com/Quorafind/Obsidian-Task-Genius/commit/f6a82d341ab48718156de361692e0eef4dcc41d4))

### Chores

* remove unused files ([8d0c349](https://github.com/Quorafind/Obsidian-Task-Genius/commit/8d0c349f5c7780759f77c717d06c205867bc5f0f))
* update workflow scripts ([166be92](https://github.com/Quorafind/Obsidian-Task-Genius/commit/166be925a45414f77e9a04c4381ac6ccf35b1909))
* update workflow scripts ([795340e](https://github.com/Quorafind/Obsidian-Task-Genius/commit/795340e621aa9803fd4129f18e4b50e0f6a87fec))
* update workflow scripts and fix github tag issues ([134bfb8](https://github.com/Quorafind/Obsidian-Task-Genius/commit/134bfb8dc2f4f28ac7ecde4e4df3442c193ad46f))
* update workflow scripts and fix github tag issues ([addf04a](https://github.com/Quorafind/Obsidian-Task-Genius/commit/addf04a9c2658af1cce6c0f370b0241b9a350065))
* update workflow scripts and fix github tag issues ([60b3f72](https://github.com/Quorafind/Obsidian-Task-Genius/commit/60b3f7290d4619711183c58515147dc3d0154493))
* update workflow scripts and fix github tag issues ([dedc02b](https://github.com/Quorafind/Obsidian-Task-Genius/commit/dedc02b75fac91640ecddd354c7cc3fb57561c5d))
* update workflow scripts and fix github tag issues ([aef0fb8](https://github.com/Quorafind/Obsidian-Task-Genius/commit/aef0fb82aa8ff134cdfdc3e1b7120e86ca85ba41))
