import assert from "node:assert";
import { describe, it } from "node:test";
import { KeybindingsManager, TUI_KEYBINDINGS } from "../src/keybindings.ts";

describe("KeybindingsManager", () => {
	it("binds Ctrl+J as a default newline alias", () => {
		const keybindings = new KeybindingsManager(TUI_KEYBINDINGS);

		assert.deepStrictEqual(keybindings.getKeys("tui.input.newLine"), ["shift+enter", "ctrl+j"]);
		assert.strictEqual(keybindings.matches("\n", "tui.input.newLine"), true);
		assert.strictEqual(keybindings.matches("\x1b[106;5u", "tui.input.newLine"), true);
	});

	it("binds modified and unmodified editor viewport navigation", () => {
		const keybindings = new KeybindingsManager(TUI_KEYBINDINGS);

		assert.deepStrictEqual(keybindings.getKeys("tui.editor.cursorLineStart"), ["home", "ctrl+home"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.editor.cursorLineEnd"), ["end", "ctrl+end", "ctrl+e"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.editor.selectAll"), ["ctrl+a"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.editor.selectLeft"), ["shift+left"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.editor.selectRight"), ["shift+right"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.editor.selectUp"), ["shift+up"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.editor.selectDown"), ["shift+down"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.editor.pageUp"), ["pageUp", "ctrl+pageUp"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.editor.pageDown"), ["pageDown", "ctrl+pageDown"]);
	});

	it("registers every range-selection default and recognizes modified navigation sequences", () => {
		const kb = new KeybindingsManager(TUI_KEYBINDINGS);
		for (const [action, keys, sequence] of [
			["selectLeft", ["shift+left"], "\x1b[1;2D"],
			["selectRight", ["shift+right"], "\x1b[1;2C"],
			["selectUp", ["shift+up"], "\x1b[1;2A"],
			["selectDown", ["shift+down"], "\x1b[1;2B"],
			["selectWordLeft", ["ctrl+shift+left", "alt+shift+left"], "\x1b[1;6D"],
			["selectWordRight", ["ctrl+shift+right", "alt+shift+right"], "\x1b[1;4C"],
			["selectLineStart", ["shift+home"], "\x1b[1;2H"],
			["selectLineEnd", ["shift+end"], "\x1b[1;2F"],
			["selectPageUp", ["shift+pageUp"], "\x1b[5;2~"],
			["selectPageDown", ["shift+pageDown"], "\x1b[6;2~"],
			["selectDocumentStart", ["ctrl+shift+home"], "\x1b[1;6H"],
			["selectDocumentEnd", ["ctrl+shift+end"], "\x1b[1;6F"],
			["selectAll", ["ctrl+a"], "\x01"],
		] as const) {
			const id = `tui.editor.${action}` as keyof typeof TUI_KEYBINDINGS;
			assert.deepStrictEqual(kb.getKeys(id), keys);
			assert.equal(kb.matches(sequence, id), true, id);
		}
		assert.equal(kb.matches("\x1b[1;4D", "tui.editor.selectWordLeft"), true);
		assert.equal(kb.matches("\x1b[5~", "tui.editor.selectPageUp"), false);
		assert.deepStrictEqual(kb.getConflicts(), []);
	});

	it("keeps transcript and editor bindings independent when a user creates a routing collision", () => {
		const kb = new KeybindingsManager(TUI_KEYBINDINGS, {
			"tui.altScreen.pageUp": "shift+pageUp",
			"tui.editor.selectPageUp": "shift+pageUp",
		});
		assert.deepStrictEqual(kb.getConflicts(), [
			{
				key: "shift+pageUp",
				keybindings: ["tui.altScreen.pageUp", "tui.editor.selectPageUp"],
			},
		]);
		assert.equal(kb.matches("\x1b[5;2~", "tui.altScreen.pageUp"), true);
		assert.equal(kb.matches("\x1b[5;2~", "tui.editor.selectPageUp"), true);
		assert.deepStrictEqual(kb.getKeys("tui.editor.pageUp"), ["pageUp", "ctrl+pageUp"]);
	});

	it("allows overriding the keyboard selection tracer bindings", () => {
		const keybindings = new KeybindingsManager(TUI_KEYBINDINGS, {
			"tui.editor.selectLeft": "alt+shift+left",
			"tui.editor.selectAll": "ctrl+shift+a",
		});
		assert.deepStrictEqual(keybindings.getKeys("tui.editor.selectLeft"), ["alt+shift+left"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.editor.selectAll"), ["ctrl+shift+a"]);
		assert.strictEqual(keybindings.matches("\x01", "tui.editor.selectAll"), false);
	});

	it("leaves dedicated prompt history navigation unbound by default", () => {
		const keybindings = new KeybindingsManager(TUI_KEYBINDINGS);

		assert.deepStrictEqual(keybindings.getKeys("tui.editor.historyPrevious"), []);
		assert.deepStrictEqual(keybindings.getKeys("tui.editor.historyNext"), []);
	});

	it("binds unmodified terminal viewport shortcuts to alternate-screen navigation", () => {
		const keybindings = new KeybindingsManager(TUI_KEYBINDINGS);

		assert.deepStrictEqual(keybindings.getKeys("tui.altScreen.pageUp"), ["pageUp"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.altScreen.pageDown"), ["pageDown"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.altScreen.halfPageUp"), []);
		assert.deepStrictEqual(keybindings.getKeys("tui.altScreen.halfPageDown"), []);
		assert.deepStrictEqual(keybindings.getKeys("tui.altScreen.lineUp"), []);
		assert.deepStrictEqual(keybindings.getKeys("tui.altScreen.lineDown"), []);
		assert.deepStrictEqual(keybindings.getKeys("tui.altScreen.previousPrompt"), ["ctrl+shift+up", "ctrl+up"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.altScreen.nextPrompt"), ["ctrl+shift+down", "ctrl+down"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.altScreen.search"), ["ctrl+shift+f"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.altScreen.searchNext"), ["enter", "ctrl+g"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.altScreen.searchPrevious"), ["shift+enter", "ctrl+shift+g"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.altScreen.searchClose"), ["escape"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.altScreen.top"), ["home"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.altScreen.bottom"), ["end"]);
	});

	it("does not evict selector confirm when input submit is rebound", () => {
		const keybindings = new KeybindingsManager(TUI_KEYBINDINGS, {
			"tui.input.submit": ["enter", "ctrl+enter"],
		});

		assert.deepStrictEqual(keybindings.getKeys("tui.input.submit"), ["enter", "ctrl+enter"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.select.confirm"), ["enter"]);
	});

	it("does not evict cursor bindings when another action reuses the same key", () => {
		const keybindings = new KeybindingsManager(TUI_KEYBINDINGS, {
			"tui.select.up": ["up", "ctrl+p"],
		});

		assert.deepStrictEqual(keybindings.getKeys("tui.select.up"), ["up", "ctrl+p"]);
		assert.deepStrictEqual(keybindings.getKeys("tui.editor.cursorUp"), ["up"]);
	});

	it("still reports direct user binding conflicts without evicting defaults", () => {
		const keybindings = new KeybindingsManager(TUI_KEYBINDINGS, {
			"tui.input.submit": "ctrl+x",
			"tui.select.confirm": "ctrl+x",
		});

		assert.deepStrictEqual(keybindings.getConflicts(), [
			{
				key: "ctrl+x",
				keybindings: ["tui.input.submit", "tui.select.confirm"],
			},
		]);
		assert.deepStrictEqual(keybindings.getKeys("tui.editor.cursorLeft"), ["left", "ctrl+b"]);
	});
});
