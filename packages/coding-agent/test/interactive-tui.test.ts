import type { Component, Terminal, TUI } from "@earendil-works/pi-tui";
import { Container, getKeybindings, isViewportTUI, ScrollView, setKeybindings, Text } from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "../../tui/src/components/editor.ts";
import { defaultEditorTheme } from "../../tui/test/test-themes.ts";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import type { FullscreenExitOutput, TuiMode } from "../src/core/settings-manager.ts";
import { createChatViewport } from "../src/modes/interactive/chat-viewport.ts";
import { CustomEditor } from "../src/modes/interactive/components/custom-editor.ts";
import {
	BranchSummaryStatusIndicator,
	CompactionStatusIndicator,
	RetryStatusIndicator,
	type StatusIndicator,
	type StatusIndicatorKind,
	WorkingStatusIndicator,
} from "../src/modes/interactive/components/status-indicator.ts";
import { UserMessageComponent } from "../src/modes/interactive/components/user-message.ts";
import {
	createInteractiveTui,
	createInteractiveTuiReference,
	InteractiveMode,
} from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

const clipboardMocks = vi.hoisted(() => ({
	copyToClipboard: vi.fn<(text: string) => Promise<void>>(),
	readClipboardText: vi.fn<() => Promise<string | null>>(),
}));

vi.mock("../src/utils/clipboard.ts", () => clipboardMocks);

class RecordingTerminal extends VirtualTerminal implements Terminal {
	readonly writes: string[] = [];
	startCount = 0;
	stopCount = 0;

	override start(onInput: (data: string) => void, onResize: () => void): void {
		this.startCount += 1;
		super.start(onInput, onResize);
	}

	override write(data: string): void {
		this.writes.push(data);
		super.write(data);
	}

	override stop(): void {
		this.stopCount += 1;
		super.stop();
	}
}

describe("createInteractiveTui", () => {
	it("selects the alternate-screen renderer only when requested", async () => {
		const mainTerminal = new RecordingTerminal();
		const mainTui = createInteractiveTui({
			tuiMode: "regular",
			showHardwareCursor: false,
			logDirectory: "/tmp",
			terminal: mainTerminal,
		});
		expect(mainTui.mode).toBe("regular");
		expect(isViewportTUI(mainTui)).toBe(false);
		mainTui.start();
		await mainTerminal.waitForRender();
		expect(mainTerminal.writes.some((write) => write.includes("\x1b[?1049h"))).toBe(false);
		mainTui.stop();

		const altTerminal = new RecordingTerminal();
		const altTui = createInteractiveTui({
			tuiMode: "fullscreen",
			showHardwareCursor: false,
			logDirectory: "/tmp",
			terminal: altTerminal,
		});
		expect(altTui.mode).toBe("fullscreen");
		expect(isViewportTUI(altTui)).toBe(true);
		altTui.start();
		await altTerminal.waitForRender();
		expect(altTerminal.writes.some((write) => write.includes("\x1b[?1049h"))).toBe(true);
		altTui.stop();
	});

	it("shows the configured jump-to-bottom shortcut while scrolled up", async () => {
		initTheme("dark");
		const previousKeybindings = getKeybindings();
		setKeybindings(new KeybindingsManager({ "tui.altScreen.bottom": "ctrl+j" }));
		const terminal = new RecordingTerminal(50, 4);
		const ui = createInteractiveTui({
			tuiMode: "fullscreen",
			showHardwareCursor: false,
			logDirectory: "/tmp",
			terminal,
		});
		ui.setLayoutRoot(
			new ScrollView(new Text(Array.from({ length: 8 }, (_, index) => `line ${index + 1}`).join("\n"), 0, 0), {
				follow: "end",
				primary: true,
			}),
		);
		ui.start();
		try {
			await terminal.waitForRender();
			terminal.sendInput("\x1b[<64;1;1M");
			await terminal.waitForRender();
			expect(terminal.getViewport()[3]).toContain("↓ Jump to latest message · Ctrl+J");
		} finally {
			ui.stop();
			setKeybindings(previousKeybindings);
		}
	});

	it("keeps the standard prompt marker but not the private user marker in regular terminal output", async () => {
		initTheme("dark");
		const terminal = new RecordingTerminal(60, 8);
		const ui = createInteractiveTui({
			tuiMode: "regular",
			showHardwareCursor: false,
			logDirectory: "/tmp",
			terminal,
		});
		ui.addChild(new UserMessageComponent("prompt"));
		ui.start();
		try {
			await terminal.waitForRender();
			const output = terminal.writes.join("");
			expect(output).toContain("\x1b]133;A\x07");
			expect(output).not.toContain("\x1b]133;P;pi-user\x07");
		} finally {
			ui.stop();
		}
	});

	it("jumps from the top control to the latest user prompt, then an older prompt", async () => {
		initTheme("dark");
		const terminal = new RecordingTerminal(60, 6);
		const ui = createInteractiveTui({
			tuiMode: "fullscreen",
			showHardwareCursor: false,
			logDirectory: "/tmp",
			terminal,
		});
		const document = new Container();
		for (const number of [1, 2, 3]) {
			document.addChild(new UserMessageComponent(`prompt ${number}`));
			document.addChild(new Text(`\x1b]133;A\x07reply ${number}\nresponse\nresponse\nresponse`, 0, 0));
		}
		const viewport = createChatViewport({
			document,
			pendingMessages: new Container(),
			status: new Container(),
			editor: new Text("editor", 0, 0),
			footer: new Text("footer", 0, 0),
		});
		ui.setLayoutRoot(viewport.root);
		ui.start();
		try {
			await terminal.waitForRender();
			ui.scrollBy(-1);
			await terminal.waitForRender();
			let screen = terminal.getViewport();
			expect(screen[0]).toContain("Jump to latest prompt");
			const column = screen[0]!.indexOf("Jump to latest prompt") + 2;
			terminal.sendInput(`\x1b[<0;${column};1M`);
			terminal.sendInput(`\x1b[<0;${column};1m`);
			await terminal.waitForRender();
			expect(terminal.getViewport().some((line) => line.includes("prompt 3"))).toBe(true);
			expect(terminal.getViewport()[0]).not.toContain("Jump to latest prompt");
			ui.scrollBy(-1);
			await terminal.waitForRender();
			screen = terminal.getViewport();
			expect(screen[0]).toContain("Jump to latest prompt");
			terminal.sendInput(`\x1b[<0;${column};1M`);
			terminal.sendInput(`\x1b[<0;${column};1m`);
			await terminal.waitForRender();
			expect(terminal.getViewport().some((line) => line.includes("prompt 2"))).toBe(true);
			ui.scrollBy(-1);
			await terminal.waitForRender();
			terminal.sendInput(`\x1b[<0;${column};1M`);
			terminal.sendInput(`\x1b[<0;${column};1m`);
			await terminal.waitForRender();
			expect(terminal.getViewport().some((line) => line.includes("prompt 1"))).toBe(true);
			ui.scrollToTop();
			await terminal.waitForRender();
			expect(terminal.getViewport()[0]).not.toContain("Jump to latest prompt");
			expect(terminal.writes.every((write) => !write.includes("\x1b]133;P;pi-user"))).toBe(true);
		} finally {
			ui.stop();
		}
	});

	it("uses Alt+Home to jump to preceding user prompts without changing Home", async () => {
		initTheme("dark");
		const terminal = new RecordingTerminal(60, 6);
		const ui = createInteractiveTui({
			tuiMode: "fullscreen",
			showHardwareCursor: false,
			logDirectory: "/tmp",
			terminal,
		});
		const document = new Container();
		for (const number of [1, 2, 3]) {
			document.addChild(new UserMessageComponent(`prompt ${number}`));
			document.addChild(new Text(`\x1b]133;A\x07reply ${number}\n${"response\n".repeat(8)}`, 0, 0));
		}
		ui.setLayoutRoot(
			createChatViewport({
				document,
				pendingMessages: new Container(),
				status: new Container(),
				editor: new Text("editor", 0, 0),
				footer: new Text("footer", 0, 0),
			}).root,
		);
		ui.start();
		try {
			await terminal.waitForRender();
			const bottom = ui.viewportTop;
			terminal.sendInput("\x1b[1;3H");
			await terminal.waitForRender();
			expect(ui.viewportTop).toBeLessThan(bottom);
			expect(terminal.getViewport().some((line) => line.includes("prompt 3"))).toBe(true);
			ui.scrollBy(-1);
			await terminal.waitForRender();
			expect(terminal.getViewport()[0]).toMatch(/Jump to latest prompt · (?:Alt|Option)\+Home/);
			terminal.sendInput("\x1b[1;3H");
			await terminal.waitForRender();
			expect(terminal.getViewport().some((line) => line.includes("prompt 2"))).toBe(true);
			ui.scrollBy(-1);
			await terminal.waitForRender();
			terminal.sendInput("\x1b[1;3H");
			await terminal.waitForRender();
			expect(terminal.getViewport().some((line) => line.includes("prompt 1"))).toBe(true);
			terminal.sendInput("\x1b[H");
			await terminal.waitForRender();
			expect(terminal.getViewport().some((line) => line.includes("prompt 1"))).toBe(true);
		} finally {
			ui.stop();
		}
	});

	it("deletes a fullscreen mouse selection in the prompt when its old cursor is outside the range", async () => {
		const terminal = new RecordingTerminal(120, 36);
		const ui = createInteractiveTui({
			tuiMode: "fullscreen",
			showHardwareCursor: false,
			logDirectory: "/tmp",
			terminal,
		});
		const editor = new CustomEditor(ui, defaultEditorTheme, new KeybindingsManager());
		const editorContainer = new Container();
		editorContainer.addChild(editor);
		const viewport = createChatViewport({
			document: new Text("transcript", 0, 0),
			pendingMessages: new Container(),
			status: new Container(),
			editor: editorContainer,
			footer: new Text("footer", 0, 0),
		});
		editor.setText("first\nsecond\nthird");
		ui.setLayoutRoot(viewport.root);
		ui.setFocus(editor);
		ui.start();
		try {
			await terminal.waitForRender();
			const lines = terminal.getViewport();
			const second = lines.findIndex((line) => line.includes("second")) + 1;
			const third = lines.findIndex((line) => line.includes("third")) + 1;
			expect(second).toBeGreaterThan(0);
			expect(third).toBeGreaterThan(second);
			terminal.sendInput(`\x1b[<0;1;${second}M`);
			terminal.sendInput(`\x1b[<32;6;${third}M`);
			terminal.sendInput(`\x1b[<0;6;${third}m`);
			await terminal.waitForRender();
			terminal.sendInput("\x7f");
			expect(editor.getText()).toBe("first\n");
		} finally {
			ui.stop();
		}
	});

	it("keeps an unchanged editor selection across regular and fullscreen renderer switches", async () => {
		const terminal = new RecordingTerminal(40, 8);
		const renderer = createInteractiveTui({
			tuiMode: "regular",
			showHardwareCursor: false,
			logDirectory: "/tmp",
			terminal,
		});
		const editor = new Editor(renderer, defaultEditorTheme);
		editor.setText("selected prompt");
		editor.handleInput("\x01");
		renderer.addChild(editor);
		renderer.setFocus(editor);
		const context = Object.assign(Object.create(InteractiveMode.prototype), {
			runtimeHost: { session: { settingsManager: { getFullscreenCopyOnSelect: () => true } } },
			renderer,
			fullscreenLayoutRoot: editor,
			options: { tuiMode: "regular" as TuiMode },
			themeController: { rebindTui: () => {} },
			extensionTerminalInputSubscriptions: new Set<never>(),
		}) as { renderer: ReturnType<typeof createInteractiveTui>; ui: TUI };
		context.ui = createInteractiveTuiReference(() => context.renderer);
		const switchMode = InteractiveMode.prototype as unknown as {
			switchTuiMode(this: typeof context, mode: TuiMode, restoreProgress?: boolean): boolean;
		};
		renderer.start();
		try {
			for (const mode of ["fullscreen", "regular"] as const) {
				expect(switchMode.switchTuiMode.call(context, mode, false)).toBe(true);
				await terminal.waitForRender();
				expect(context.renderer.getFocusedComponent()).toBe(editor);
				expect(editor.getSelectedText()).toBe("selected prompt");
			}
		} finally {
			context.renderer.stop();
		}
	});

	it("replaces the renderer and restores the previous screen for resume-hint exits", async () => {
		const terminal = new RecordingTerminal(40, 8);
		const renderer = createInteractiveTui({
			tuiMode: "regular",
			showHardwareCursor: false,
			logDirectory: "/tmp",
			terminal,
		});
		let stableUi: TUI;
		const invalidatedModes: TuiMode[] = [];
		const component: Component & { focused: boolean } = {
			focused: false,
			render: () => ["content"],
			invalidate: () => invalidatedModes.push(stableUi.mode),
		};
		renderer.addChild(component);
		renderer.setFocus(component);

		type SwitchContext = {
			runtimeHost: { session: { settingsManager: { getFullscreenCopyOnSelect: () => boolean } } };
			renderer: ReturnType<typeof createInteractiveTui>;
			ui: TUI;
			fullscreenLayoutRoot: Component;
			options: { tuiMode?: TuiMode };
			themeController: { rebindTui: () => void };
			extensionTerminalInputSubscriptions: Set<never>;
		};
		const context = Object.assign(Object.create(InteractiveMode.prototype), {
			runtimeHost: { session: { settingsManager: { getFullscreenCopyOnSelect: () => true } } },
			renderer,
			ui: undefined as unknown as TUI,
			fullscreenLayoutRoot: component,
			options: { tuiMode: "regular" as TuiMode },
			themeController: { rebindTui: () => {} },
			extensionTerminalInputSubscriptions: new Set<never>(),
		}) as SwitchContext;
		stableUi = createInteractiveTuiReference(() => context.renderer);
		context.ui = stableUi;
		const { stopInteractiveTui, switchTuiMode } = InteractiveMode.prototype as unknown as {
			stopInteractiveTui(this: SwitchContext, fullscreenExitOutput: FullscreenExitOutput): void;
			switchTuiMode(this: SwitchContext, mode: TuiMode, restoreProgress?: boolean): boolean;
		};

		renderer.start();
		await terminal.waitForRender();
		expect(switchTuiMode.call(context, "fullscreen", false)).toBe(true);
		await terminal.waitForRender();

		expect(stableUi.mode).toBe("fullscreen");
		expect(context.renderer.children).toEqual([component]);
		expect(context.renderer.getFocusedComponent()).toBe(component);
		expect(component.focused).toBe(true);
		expect(invalidatedModes).toEqual(["fullscreen"]);
		expect([terminal.startCount, terminal.stopCount]).toEqual([2, 1]);

		stopInteractiveTui.call(context, "resume-hint");

		expect(stableUi.mode).toBe("fullscreen");
		expect([terminal.startCount, terminal.stopCount]).toEqual([2, 2]);
	});
});

describe("Fullscreen image marker copy", () => {
	it("copies the underlying path for a complete selected marker", async () => {
		clipboardMocks.copyToClipboard.mockReset();
		clipboardMocks.copyToClipboard.mockResolvedValue(undefined);
		const terminal = new RecordingTerminal(40, 6);
		const ui = createInteractiveTui({
			tuiMode: "fullscreen",
			showHardwareCursor: false,
			logDirectory: "/tmp",
			terminal,
			transformCopiedText: (text) => text.replace("[Image 1]", "/tmp/photo.png"),
		});
		ui.addChild(new Text("[Image 1]", 0, 0));
		ui.start();
		try {
			await terminal.waitForRender();
			terminal.sendInput("\x1b[<0;1;1M");
			terminal.sendInput("\x1b[<32;10;1M");
			terminal.sendInput("\x1b[<0;10;1m");
			await terminal.waitForRender();
			expect(clipboardMocks.copyToClipboard).toHaveBeenCalledWith("/tmp/photo.png");
		} finally {
			ui.stop();
		}
	});
});

describe("InteractiveMode extension headers", () => {
	it("keeps Pi's startup header when an extension adds a header", () => {
		const builtInHeader = new Text("Pi startup", 0, 0);
		const extensionHeader = new Text("Powerline welcome", 0, 0);
		const headerContainer = new Container();
		headerContainer.addChild(builtInHeader);
		const context = {
			builtInHeader,
			customHeader: undefined,
			extensionHeaders: new Map(),
			headerContainer,
			toolOutputExpanded: false,
			ui: { requestRender: vi.fn() },
		};
		const prototype = InteractiveMode.prototype as unknown as {
			setExtensionHeaderWidget(this: typeof context, key: string, factory: () => Component | undefined): void;
		};

		prototype.setExtensionHeaderWidget.call(context, "powerline-welcome", () => extensionHeader);

		expect(headerContainer.children).toEqual([builtInHeader, extensionHeader]);
	});
});

describe("InteractiveMode right-click paste", () => {
	it("feeds clipboard text to the focused component as a bracketed paste", async () => {
		clipboardMocks.readClipboardText.mockResolvedValue("clipboard text");
		const handleInput = vi.fn<(data: string) => void>();
		const target = { render: () => [], invalidate: () => {}, handleInput } satisfies Component;
		const requestRender = vi.fn();
		const context = {
			renderer: { getFocusedComponent: () => target },
			ui: { requestRender },
		};
		const prototype = InteractiveMode.prototype as unknown as {
			handleRightClickPaste(this: typeof context): Promise<void>;
		};

		await prototype.handleRightClickPaste.call(context);

		expect(handleInput).toHaveBeenCalledWith("\x1b[200~clipboard text\x1b[201~");
		expect(requestRender).toHaveBeenCalledOnce();
	});
});

type CopyCommandContext = {
	session: { getLastAssistantText: () => string | undefined };
	ui: ReturnType<typeof createInteractiveTui>;
	editor?: Editor;
	showStatus: (message: string) => void;
	showError: (message: string) => void;
};

type CopyCommandOptions = { flashConfirmation?: boolean; preferSelection?: boolean };

type CopyCommandPrototype = {
	handleCopyCommand(this: CopyCommandContext, options?: CopyCommandOptions): Promise<void>;
};

const copyCommandPrototype = InteractiveMode.prototype as unknown as CopyCommandPrototype;

describe("InteractiveMode copy confirmation", () => {
	beforeEach(() => {
		clipboardMocks.copyToClipboard.mockReset();
		clipboardMocks.copyToClipboard.mockResolvedValue(undefined);
	});

	it("routes Ctrl+X to editor copy while Ctrl+C keeps its clear action", async () => {
		const ui = createInteractiveTui({
			tuiMode: "regular",
			showHardwareCursor: false,
			logDirectory: "/tmp",
			terminal: new RecordingTerminal(),
		});
		const editor = new CustomEditor(ui, defaultEditorTheme, new KeybindingsManager());
		const clear = vi.fn();
		editor.onAction("app.clear", clear);
		const context: CopyCommandContext = {
			session: { getLastAssistantText: () => "assistant response" },
			ui,
			editor,
			showStatus: vi.fn(),
			showError: vi.fn(),
		};
		editor.onAction("app.message.copy", () => {
			void copyCommandPrototype.handleCopyCommand.call(context, { preferSelection: true });
		});
		editor.setText("selected prompt");
		editor.handleInput("\x01");
		editor.handleInput("\x18");
		await vi.waitFor(() => expect(clipboardMocks.copyToClipboard).toHaveBeenCalledWith("selected prompt"));
		expect(editor.getSelectedText()).toBe("selected prompt");
		editor.handleInput("\x03");
		expect(clear).toHaveBeenCalledOnce();
		expect(editor.getText()).toBe("selected prompt");
	});

	it("copies the editor range before the assistant message without consuming the range", async () => {
		const ui = createInteractiveTui({
			tuiMode: "regular",
			showHardwareCursor: false,
			logDirectory: "/tmp",
			terminal: new RecordingTerminal(),
		});
		const editor = new Editor(ui, defaultEditorTheme);
		editor.setText("first\nsecond");
		editor.handleInput("\x01");
		expect(clipboardMocks.copyToClipboard).not.toHaveBeenCalled();
		const getLastAssistantText = vi.fn(() => "assistant response");
		const showError = vi.fn();
		await copyCommandPrototype.handleCopyCommand.call(
			{ session: { getLastAssistantText }, ui, editor, showStatus: vi.fn(), showError },
			{ preferSelection: true },
		);
		expect(clipboardMocks.copyToClipboard).toHaveBeenCalledWith("first\nsecond");
		expect(getLastAssistantText).not.toHaveBeenCalled();
		await copyCommandPrototype.handleCopyCommand.call(
			{ session: { getLastAssistantText }, ui, editor, showStatus: vi.fn(), showError },
			{ preferSelection: true },
		);
		expect(clipboardMocks.copyToClipboard).toHaveBeenCalledTimes(2);
		expect(editor.getText()).toBe("first\nsecond");
	});

	it("prefers editor selection over an active fullscreen screen selection", async () => {
		const terminal = new RecordingTerminal(40, 6);
		const ui = createInteractiveTui({
			tuiMode: "fullscreen",
			showHardwareCursor: false,
			logDirectory: "/tmp",
			terminal,
			fullscreenCopyOnSelect: false,
		});
		ui.addChild(new Text("screen text\nother text", 0, 0));
		const editor = new Editor(ui, defaultEditorTheme);
		editor.setText("editor text");
		editor.handleInput("\x01");
		ui.start();
		try {
			await terminal.waitForRender();
			terminal.sendInput("\x1b[<0;1;1M");
			terminal.sendInput("\x1b[<32;4;1M");
			terminal.sendInput("\x1b[<0;4;1m");
			await terminal.waitForRender();
			const getLastAssistantText = vi.fn(() => "assistant response");
			await copyCommandPrototype.handleCopyCommand.call(
				{ session: { getLastAssistantText }, ui, editor, showStatus: vi.fn(), showError: vi.fn() },
				{ preferSelection: true },
			);
			expect(clipboardMocks.copyToClipboard).toHaveBeenLastCalledWith("editor text");
			expect(getLastAssistantText).not.toHaveBeenCalled();
		} finally {
			ui.stop();
		}
	});

	it("copies an active fullscreen selection when copy-on-select is disabled", async () => {
		const terminal = new RecordingTerminal(40, 4);
		const ui = createInteractiveTui({
			tuiMode: "fullscreen",
			showHardwareCursor: false,
			logDirectory: "/tmp",
			terminal,
			fullscreenCopyOnSelect: false,
		});
		const getLastAssistantText = vi.fn(() => "assistant response");
		const showStatus = vi.fn();
		const showError = vi.fn();
		const context: CopyCommandContext = {
			session: { getLastAssistantText },
			ui,
			showStatus,
			showError,
		};
		ui.addChild(new Text("alpha\nbeta\ngamma\ndelta", 0, 0));

		ui.start();
		try {
			await terminal.waitForRender();
			terminal.sendInput("\x1b[<0;1;1M");
			terminal.sendInput("\x1b[<32;4;2M");
			terminal.sendInput("\x1b[<0;4;2m");
			await terminal.waitForRender();
			clipboardMocks.copyToClipboard.mockClear();

			await copyCommandPrototype.handleCopyCommand.call(context, { flashConfirmation: true, preferSelection: true });
			await terminal.waitForRender();

			expect(clipboardMocks.copyToClipboard).toHaveBeenCalledOnce();
			expect(clipboardMocks.copyToClipboard).toHaveBeenCalledWith("alpha\nbeta");
			expect(getLastAssistantText).not.toHaveBeenCalled();
			expect(showStatus).not.toHaveBeenCalled();
			expect(showError).not.toHaveBeenCalled();
			expect(terminal.getViewport().some((line) => line.includes("Copied!"))).toBe(true);
		} finally {
			ui.stop();
		}
	});

	it("copies the last assistant message with an active fullscreen selection when copy-on-select is enabled", async () => {
		const terminal = new RecordingTerminal(40, 4);
		const ui = createInteractiveTui({
			tuiMode: "fullscreen",
			showHardwareCursor: false,
			logDirectory: "/tmp",
			terminal,
		});
		const getLastAssistantText = vi.fn(() => "assistant response");
		const showStatus = vi.fn();
		const showError = vi.fn();
		const context: CopyCommandContext = {
			session: { getLastAssistantText },
			ui,
			showStatus,
			showError,
		};
		ui.addChild(new Text("alpha\nbeta\ngamma\ndelta", 0, 0));

		ui.start();
		try {
			await terminal.waitForRender();
			terminal.sendInput("\x1b[<0;1;1M");
			terminal.sendInput("\x1b[<32;4;2M");
			terminal.sendInput("\x1b[<0;4;2m");
			await terminal.waitForRender();
			clipboardMocks.copyToClipboard.mockClear();

			await copyCommandPrototype.handleCopyCommand.call(context, { flashConfirmation: true, preferSelection: true });
			await terminal.waitForRender();

			expect(clipboardMocks.copyToClipboard).toHaveBeenCalledOnce();
			expect(clipboardMocks.copyToClipboard).toHaveBeenCalledWith("assistant response");
			expect(getLastAssistantText).toHaveBeenCalledOnce();
			expect(showStatus).not.toHaveBeenCalled();
			expect(showError).not.toHaveBeenCalled();
			expect(terminal.getViewport().some((line) => line.includes("Copied!"))).toBe(true);
		} finally {
			ui.stop();
		}
	});

	it("flashes Copied! for the copy shortcut in fullscreen mode", async () => {
		const terminal = new RecordingTerminal(40, 4);
		const ui = createInteractiveTui({
			tuiMode: "fullscreen",
			showHardwareCursor: false,
			logDirectory: "/tmp",
			terminal,
		});
		const showStatus = vi.fn();
		const showError = vi.fn();
		const context: CopyCommandContext = {
			session: { getLastAssistantText: () => "assistant response" },
			ui,
			showStatus,
			showError,
		};

		ui.start();
		try {
			await terminal.waitForRender();
			await copyCommandPrototype.handleCopyCommand.call(context, { flashConfirmation: true, preferSelection: true });
			await terminal.waitForRender();

			expect(clipboardMocks.copyToClipboard).toHaveBeenCalledWith("assistant response");
			expect(showStatus).not.toHaveBeenCalled();
			expect(showError).not.toHaveBeenCalled();
			expect(terminal.getViewport().some((line) => line.includes("Copied!"))).toBe(true);
		} finally {
			ui.stop();
		}
	});

	it("keeps the status-line confirmation for the copy shortcut in regular mode", async () => {
		const ui = createInteractiveTui({
			tuiMode: "regular",
			showHardwareCursor: false,
			logDirectory: "/tmp",
			terminal: new RecordingTerminal(),
		});
		const showStatus = vi.fn();
		const showError = vi.fn();
		const context: CopyCommandContext = {
			session: { getLastAssistantText: () => "assistant response" },
			ui,
			showStatus,
			showError,
		};

		await copyCommandPrototype.handleCopyCommand.call(context, { flashConfirmation: true, preferSelection: true });

		expect(showStatus).toHaveBeenCalledWith("Copied last agent message to clipboard");
		expect(showError).not.toHaveBeenCalled();
	});
});

type StatusEditor = {
	embedWorkingStatus: boolean;
	setWorkingStatusIndicator: (indicator: StatusIndicator | undefined) => void;
};

type ClearStatusContext = {
	activeStatusIndicator: { kind: StatusIndicatorKind; dispose: () => void } | undefined;
	activeWorkingIndicatorEmbedded: boolean;
	statusContainer: Container;
	defaultEditor: StatusEditor;
	editor: Partial<StatusEditor>;
	options: { tuiMode?: TuiMode };
	ui: { getClearOnShrink: () => boolean };
	idleStatus: Component;
	setEditorWorkingStatusIndicator(indicator: StatusIndicator | undefined): boolean;
};

type InteractiveModePrototype = {
	showStatusIndicator(this: ClearStatusContext, indicator: StatusIndicator): void;
	clearStatusIndicator(this: ClearStatusContext, kind?: StatusIndicatorKind): void;
	setEditorWorkingStatusIndicator(this: ClearStatusContext, indicator: StatusIndicator | undefined): boolean;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown as InteractiveModePrototype;

describe("clear-on-shrink status spacing", () => {
	it.each([true, false])("routes every status through the editor opt-in (%s)", (embedWorkingStatus) => {
		initTheme("dark");
		const tui = { requestRender: vi.fn() } as unknown as TUI;
		const editor: StatusEditor = { embedWorkingStatus, setWorkingStatusIndicator: vi.fn() };
		const context: ClearStatusContext = {
			activeStatusIndicator: undefined,
			activeWorkingIndicatorEmbedded: false,
			statusContainer: new Container(),
			defaultEditor: { embedWorkingStatus: true, setWorkingStatusIndicator: vi.fn() },
			editor,
			options: { tuiMode: "regular" },
			ui: { getClearOnShrink: () => true },
			idleStatus: new Text("", 0, 0),
			setEditorWorkingStatusIndicator: interactiveModePrototype.setEditorWorkingStatusIndicator,
		};
		const indicators = [
			new WorkingStatusIndicator(tui, "Working"),
			new CompactionStatusIndicator(tui, "manual"),
			new CompactionStatusIndicator(tui, "threshold"),
			new CompactionStatusIndicator(tui, "overflow"),
			new BranchSummaryStatusIndicator(tui),
			new RetryStatusIndicator(tui, 1, 3, 1000),
		];
		try {
			for (const indicator of indicators) {
				interactiveModePrototype.showStatusIndicator.call(context, indicator);
				expect(context.activeStatusIndicator).toBe(indicator);
				expect(context.activeWorkingIndicatorEmbedded).toBe(embedWorkingStatus);
				if (embedWorkingStatus) {
					expect(editor.setWorkingStatusIndicator).toHaveBeenLastCalledWith(indicator);
					expect(context.statusContainer.children).toHaveLength(0);
				} else {
					expect(context.statusContainer.children).toEqual([indicator]);
				}
			}
		} finally {
			for (const indicator of indicators) indicator.dispose();
		}
	});

	it.each<StatusIndicatorKind>(["working", "compaction", "branchSummary", "retry"])(
		"does not reserve separate status height for an embedded %s indicator",
		(kind) => {
			const dispose = vi.fn();
			const editor: StatusEditor = { embedWorkingStatus: true, setWorkingStatusIndicator: vi.fn() };
			const context: ClearStatusContext = {
				activeStatusIndicator: { kind, dispose },
				activeWorkingIndicatorEmbedded: true,
				statusContainer: new Container(),
				defaultEditor: editor,
				editor,
				options: { tuiMode: "regular" },
				ui: { getClearOnShrink: () => true },
				idleStatus: new Text("", 0, 0),
				setEditorWorkingStatusIndicator: interactiveModePrototype.setEditorWorkingStatusIndicator,
			};

			interactiveModePrototype.clearStatusIndicator.call(context);

			expect(dispose).toHaveBeenCalledOnce();
			expect(editor.setWorkingStatusIndicator).toHaveBeenCalledWith(undefined);
			expect(context.statusContainer.children).toHaveLength(0);
		},
	);

	it("uses the standalone row for a custom editor that has not opted in", () => {
		for (const [tuiMode, expectedChildren] of [
			["regular", 1],
			["fullscreen", 0],
		] as const) {
			const defaultEditor: StatusEditor = { embedWorkingStatus: true, setWorkingStatusIndicator: vi.fn() };
			const customEditor = { embedWorkingStatus: false, setWorkingStatusIndicator: vi.fn() };
			const context: ClearStatusContext = {
				activeStatusIndicator: { kind: "working", dispose: vi.fn() },
				activeWorkingIndicatorEmbedded: false,
				statusContainer: new Container(),
				defaultEditor,
				editor: customEditor,
				options: { tuiMode },
				ui: { getClearOnShrink: () => true },
				idleStatus: new Text("", 0, 0),
				setEditorWorkingStatusIndicator: interactiveModePrototype.setEditorWorkingStatusIndicator,
			};

			interactiveModePrototype.clearStatusIndicator.call(context);

			expect(defaultEditor.setWorkingStatusIndicator).toHaveBeenCalledWith(undefined);
			expect(customEditor.setWorkingStatusIndicator).not.toHaveBeenCalled();
			expect(context.statusContainer.children).toHaveLength(expectedChildren);
		}
	});
});
