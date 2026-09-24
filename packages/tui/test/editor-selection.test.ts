import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { Editor } from "../src/components/editor.ts";
import type { TUI } from "../src/tui.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { defaultEditorTheme } from "./test-themes.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

function editor(width = 40): Editor {
	return new Editor(new TuiMainScreen(new VirtualTerminal(width, 24)) as TUI, defaultEditorTheme);
}

describe("keyboard editor selection", () => {
	it("selects a grapheme with Shift+Left and replaces it with typed text", () => {
		const input = editor();
		input.setText("a😀b");
		input.handleInput("\x1b[1;2D");
		input.handleInput("X");
		assert.equal(input.getText(), "a😀X");
		assert.deepEqual(input.getCursor(), { line: 0, col: 4 });
	});

	it("renders forward and reversed ranges across logical and wrapped lines", () => {
		const input = editor(8);
		input.setText("ab😀cd\nef");
		input.render(8);
		input.handleInput("\x01");
		assert.match(input.render(8).join("\n"), /\x1b\[7mab/);
		assert.equal(stripVTControlCharacters(input.render(8).join("")).includes("ab😀cd"), true);
	});

	it("deletes a reversed multiline range in one undo unit and clears selection on undo", () => {
		const input = editor();
		input.setText("first\nsecond");
		input.handleInput("\x01");
		input.handleInput("\x7f");
		assert.equal(input.getText(), "");
		input.handleInput("\x1b[45;5u");
		assert.equal(input.getText(), "first\nsecond");
		input.handleInput("x");
		assert.equal(input.getText(), "first\nsecondx");
	});

	it("collapses toward requested direction and reverses across the anchor", () => {
		const input = editor();
		input.setText("abcd");
		input.handleInput("\x1b[1;2D");
		input.handleInput("\x1b[1;2D");
		input.handleInput("\x1b[C");
		assert.deepEqual(input.getCursor(), { line: 0, col: 4 });
		input.handleInput("\x1b[1;2D");
		input.handleInput("\x1b[1;2D");
		input.handleInput("\x1b[1;2D");
		input.handleInput("\x1b[1;2D");
		input.handleInput("\x1b[1;2D");
		input.handleInput("X");
		assert.equal(input.getText(), "X");
	});

	it("replaces a selected multiline range with newline, paste, or yank in one undo", () => {
		for (const [replacement, expected] of [
			["\x0a", "\n"],
			["\x1b[200~Z\nQ\x1b[201~", "Z\nQ"],
			["\x19", "b"],
		]) {
			const input = editor();
			input.setText("a\nb");
			if (replacement === "\x19") {
				input.handleInput("\x17");
				input.setText("a\nb");
			}
			input.handleInput("\x01");
			input.handleInput(replacement);
			assert.equal(input.getText(), expected);
			input.handleInput("\x1b[45;5u");
			assert.equal(input.getText(), "a\nb");
		}
	});

	it("removes selected paste markers atomically and restores their content on undo", () => {
		const input = editor(12);
		const first = "one\n".repeat(12);
		const second = "two\n".repeat(12);
		input.handleInput(`\x1b[200~${first}\x1b[201~`);
		input.handleInput(`\x1b[200~${second}\x1b[201~`);
		input.handleInput("\x1b[1;2D");
		input.handleInput("\x7f");
		assert.equal(input.getExpandedText(), first);
		input.handleInput(`\x1b[200~${second}\x1b[201~`);
		assert.match(input.getText(), /\[paste #2 /);
		input.handleInput("\x1b[45;5u");
		input.handleInput("\x1b[45;5u");
		assert.equal(input.getExpandedText(), first + second);
	});

	it("keeps selection replacement separate from subsequent typing in undo", () => {
		const input = editor();
		input.setText("abc");
		input.handleInput("\x1b[1;2D");
		input.handleInput("X");
		input.handleInput("Y");
		input.handleInput("\x1b[45;5u");
		assert.equal(input.getText(), "abX");
		input.handleInput("\x1b[45;5u");
		assert.equal(input.getText(), "abc");
	});

	it("yanks selected multiline and paste content only after kill commands", () => {
		const input = editor();
		input.setText("a\nb");
		input.handleInput("\x01");
		input.handleInput("\x17");
		input.handleInput("\x19");
		assert.equal(input.getText(), "a\nb");
		input.handleInput("\x01");
		input.handleInput("\x7f");
		input.handleInput("\x19");
		assert.equal(input.getText(), "a\nb");
		const paste = "a\n".repeat(12);
		input.setText("");
		input.handleInput(`\x1b[200~${paste}\x1b[201~`);
		input.handleInput("\x01");
		input.handleInput("\x0b");
		input.handleInput("\x19");
		assert.equal(input.getExpandedText(), paste);
	});

	it("selects by visible wrapped rows without adding logical newlines", () => {
		const input = editor(8);
		input.setText("abcdefghijkl");
		input.render(8);
		input.handleInput("\x1b[1;2A");
		input.handleInput("\x7f");
		assert.equal(input.getText(), "abcde");
	});

	it("clears selection on external replacement and a plain editor click", () => {
		const input = editor();
		input.setText("old");
		input.handleInput("\x01");
		input.setText("new");
		input.handleInput("X");
		assert.equal(input.getText(), "newX");
		input.render(40);
		input.handleInput("\x01");
		input.handleMouse({
			type: "click",
			button: "left",
			x: 1,
			y: 1,
			screenX: 1,
			screenY: 1,
			width: 40,
			height: 3,
			shift: false,
			alt: false,
			ctrl: false,
		});
		input.handleInput("Y");
		assert.equal(input.getText(), "nYewX");
	});

	it("does not keep an empty anchor after ordinary movement", () => {
		const input = editor();
		input.setText("ab");
		input.handleInput("\x1b[H");
		input.handleInput("\x1b[1;2D");
		input.handleInput("\x1b[C");
		input.handleInput("\x1b[1;2C");
		input.handleInput("X");
		assert.equal(input.getText(), "aX");
	});

	it("preserves a paste registry entry when another copy of its marker remains", () => {
		const input = editor();
		const paste = "line\n".repeat(12);
		input.handleInput(`\x1b[200~${paste}\x1b[201~`);
		const marker = input.getText();
		input.insertTextAtCursor(marker);
		input.handleInput("\x1b[1;2D");
		input.handleInput("\x7f");
		assert.equal(input.getExpandedText(), paste);
	});

	it("removes selected text with backward, forward, word, and line deletion", () => {
		for (const key of ["\x7f", "\x1b[3~", "\x17", "\x1bd", "\x15", "\x0b"]) {
			const input = editor();
			input.setText("a\nb");
			input.handleInput("\x01");
			input.handleInput(key);
			assert.equal(input.getText(), "", `deletion ${JSON.stringify(key)}`);
			input.handleInput("\x1b[45;5u");
			assert.equal(input.getText(), "a\nb");
		}
	});

	it("selects combining and wide graphemes without splitting their rendering", () => {
		const input = editor(8);
		input.setText("a你e\u0301😀");
		input.render(8);
		input.handleInput("\x1b[1;2D");
		input.handleInput("\x1b[1;2D");
		input.handleInput("\x7f");
		assert.equal(input.getText(), "a你");
		input.handleInput("\x1b[1;2D");
		assert.match(input.render(8).join("\n"), /\x1b\[7m你\x1b\[0m/);
	});

	it("renders the same editor selection in regular and fullscreen TUI modes", () => {
		const terminal = new VirtualTerminal(20, 24);
		for (const tui of [new TuiMainScreen(terminal), new TuiAltScreen(terminal)]) {
			const input = new Editor(tui, defaultEditorTheme);
			input.setText("first\nsecond");
			input.handleInput("\x01");
			const rendered = input.render(20).join("\n");
			assert.match(rendered, /\x1b\[7mfirst\x1b\[0m/);
			assert.match(rendered, /\x1b\[7msecond\x1b\[0m/);
		}
	});
});
