import assert from "node:assert/strict";
import { test } from "node:test";
import { Editor } from "../src/components/editor.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { defaultEditorTheme } from "./test-themes.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

function editor(): Editor {
	return new Editor(new TuiMainScreen(new VirtualTerminal(80, 24)), defaultEditorTheme);
}

test("an image path is shown as an atomic marker and submitted as a path", () => {
	const input = editor();
	input.insertImageMarker("/tmp/one.png");
	assert.equal(input.getText(), "[Image 1]");
	assert.equal(input.getExpandedText(), "/tmp/one.png");
	input.handleInput("\x01");
	input.handleInput("\x1b[C");
	assert.equal(input.getCursor().col, 9);
	let submitted = "";
	input.onSubmit = (text) => {
		submitted = text;
	};
	input.handleInput("\r");
	assert.equal(submitted, "/tmp/one.png");
	assert.equal(input.getText(), "");
});

test("deleting an image renumbers the remaining markers without changing their paths", () => {
	const input = editor();
	input.insertImageMarker("/tmp/one.png");
	input.insertTextAtCursor(" ");
	input.insertImageMarker("/tmp/two.png");
	input.handleInput("\x01");
	input.handleInput("\x1b[C");
	input.handleInput("\x7f");
	assert.equal(input.getText(), " [Image 1]");
	assert.equal(input.getExpandedText(), " /tmp/two.png");
	assert.equal(input.expandImageMarkers("[Image 1]"), "/tmp/two.png");
	assert.equal(input.expandImageMarkers("[Image"), "[Image");
});

test("forward delete removes a whole image and renumbers the draft", () => {
	const input = editor();
	input.insertImageMarker("/tmp/one.png");
	input.insertImageMarker("/tmp/two.png");
	input.handleInput("\x01");
	input.handleInput("\x04");
	assert.equal(input.getText(), "[Image 1]");
	assert.equal(input.getExpandedText(), "/tmp/two.png");
});

test("word and line deletion remove whole markers", () => {
	for (const [key, atStart] of [
		["\x17", false],
		["\x1bd", true],
		["\x15", false],
		["\x0b", true],
	] as const) {
		const input = editor();
		input.insertImageMarker("/tmp/one.png");
		input.insertTextAtCursor(" ");
		input.insertImageMarker("/tmp/two.png");
		input.handleInput("\x01");
		if (!atStart) input.handleInput("\x1b[C");
		input.handleInput(key);
		assert.equal(input.getExpandedText().includes("/tmp/one.png"), false, `key ${JSON.stringify(key)}`);
		if (key !== "\x0b") {
			assert.equal(input.getExpandedText().includes("/tmp/two.png"), true, `key ${JSON.stringify(key)}`);
			assert.equal(input.getText().includes("[Image 1]"), true);
		}
	}
});

test("image numbering is independent of large-text paste markers", () => {
	const input = editor();
	input.handleInput(`\x1b[200~${"line\n".repeat(12)}\x1b[201~`);
	input.insertImageMarker("/tmp/one.png");
	assert.match(input.getText(), /^\[paste #1 \+13 lines\]\[Image 1\]$/);
	assert.equal(input.getExpandedText(), `${"line\n".repeat(12)}/tmp/one.png`);
});

test("undo restores a deleted image path and its marker", () => {
	const input = editor();
	input.insertImageMarker("/tmp/one.png");
	input.handleInput("\x7f");
	assert.equal(input.getText(), "");
	input.handleInput("\x1f");
	assert.equal(input.getText(), "[Image 1]");
	assert.equal(input.getExpandedText(), "/tmp/one.png");
});
