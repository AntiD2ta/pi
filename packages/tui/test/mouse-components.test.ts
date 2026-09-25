import assert from "node:assert";
import { describe, it } from "node:test";
import { Editor, type EditorTheme } from "../src/components/editor.ts";
import { Input } from "../src/components/input.ts";
import { ScrollView } from "../src/components/scroll-view.ts";
import { SelectList, type SelectListTheme } from "../src/components/select-list.ts";
import { SettingsList, type SettingsListTheme } from "../src/components/settings-list.ts";
import { Text } from "../src/components/text.ts";
import { VStack } from "../src/components/v-stack.ts";
import { Container, type TuiMouseEvent, type TuiMouseEventType } from "../src/tui.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

function mouse(type: TuiMouseEventType, x: number, y: number, width = 80, height = 10): TuiMouseEvent {
	return {
		type,
		button: "left",
		x,
		y,
		screenX: x,
		screenY: y,
		width,
		height,
		shift: false,
		alt: false,
		ctrl: false,
		...(type === "click" ? { clickCount: 1 } : {}),
	};
}

const selectTheme: SelectListTheme = {
	selectedPrefix: (text) => text,
	selectedText: (text) => text,
	description: (text) => text,
	scrollInfo: (text) => text,
	noMatch: (text) => text,
};

const settingsTheme: SettingsListTheme = {
	label: (text) => text,
	value: (text) => text,
	description: (text) => text,
	cursor: "> ",
	hint: (text) => text,
};

const editorTheme: EditorTheme = {
	borderColor: (text) => text,
	selectList: selectTheme,
};

class InputOverlay extends Container {
	readonly input = new Input();

	constructor() {
		super();
		this.addChild(this.input);
	}

	handleInput(data: string): void {
		this.input.handleInput(data);
	}
}

describe("mouse-aware components", () => {
	it("positions a single-line input cursor on press", () => {
		const input = new Input();
		input.setValue("hello");
		input.render(20);

		assert.strictEqual(input.handleMouse(mouse("press", 4, 0, 20, 1))?.handled, true);
		input.handleInput("X");
		assert.strictEqual(input.getValue(), "heXllo");
	});

	it("selects and activates list rows", () => {
		const list = new SelectList(
			[
				{ value: "a", label: "A" },
				{ value: "b", label: "B" },
				{ value: "c", label: "C" },
				{ value: "d", label: "D" },
				{ value: "e", label: "E" },
			],
			3,
			selectTheme,
		);
		let selected: string | undefined;
		list.onSelect = (item) => {
			selected = item.value;
		};

		assert.strictEqual(list.handleMouse(mouse("press", 1, 2, 40, 3))?.handled, true);
		assert.strictEqual(list.getSelectedItem()?.value, "c");
		assert.strictEqual(list.handleMouse(mouse("click", 1, 2, 40, 3))?.handled, true);
		assert.strictEqual(selected, "c");
	});

	it("activates settings rows", () => {
		const changes: Array<{ id: string; value: string }> = [];
		const list = new SettingsList(
			[
				{ id: "mode", label: "Mode", currentValue: "one", values: ["one", "two"] },
				{ id: "other", label: "Other", currentValue: "off", values: ["off", "on"] },
				{ id: "third", label: "Third", currentValue: "low", values: ["low", "high"] },
				{ id: "fourth", label: "Fourth", currentValue: "x", values: ["x", "y"] },
			],
			3,
			settingsTheme,
			(id, value) => changes.push({ id, value }),
			() => {},
		);

		list.handleMouse(mouse("press", 1, 2, 40, 5));
		list.handleMouse(mouse("click", 1, 2, 40, 5));
		assert.deepStrictEqual(changes, [{ id: "third", value: "high" }]);
	});

	for (const row of [0, 4]) {
		it(`ignores hover and clicks visible select-list row ${row} after scrolling`, () => {
			const list = new SelectList(
				Array.from({ length: 12 }, (_, i) => ({ value: `item-${i}`, label: `Item ${i}` })),
				5,
				selectTheme,
			);
			const changes: string[] = [];
			let selected: string | undefined;
			list.onSelectionChange = (item) => changes.push(item.value);
			list.onSelect = (item) => {
				selected = item.value;
			};
			list.setSelectedIndex(5);
			list.handleMouse({ ...mouse("wheel", 1, row), wheelDelta: 1 });
			assert.strictEqual(list.getSelectedItem()?.value, "item-6");
			assert.deepStrictEqual(changes, ["item-6"]);
			const before = list.render(80);
			assert.match(before[row], new RegExp(`Item ${4 + row}$`));

			for (const y of [0, 1, 2, 3, 4, row]) {
				assert.strictEqual(list.handleMouse({ ...mouse("move", 1, y), button: "none" }), undefined);
				assert.deepStrictEqual(list.render(80), before);
			}
			assert.strictEqual(list.getSelectedItem()?.value, "item-6");
			assert.deepStrictEqual(changes, ["item-6"]);
			assert.strictEqual(selected, undefined);

			list.handleMouse(mouse("press", 1, row));
			list.render(80);
			list.handleMouse(mouse("click", 1, row));
			assert.strictEqual(selected, `item-${4 + row}`);
			assert.deepStrictEqual(changes, ["item-6", `item-${4 + row}`]);
		});

		it(`ignores hover and clicks visible settings row ${row} after scrolling`, () => {
			const changes: Array<{ id: string; value: string }> = [];
			const list = new SettingsList(
				Array.from({ length: 12 }, (_, i) => ({
					id: `item-${i}`,
					label: `Item ${i}`,
					description: `Description ${i}`,
					currentValue: "off",
					values: ["off", "on"],
				})),
				5,
				settingsTheme,
				(id, value) => changes.push({ id, value }),
				() => {},
				{ enableSearch: true },
			);
			list.selectItem("item-5");
			list.handleMouse({ ...mouse("wheel", 1, row + 2), wheelDelta: 1 });
			const before = list.render(80);
			assert.match(before[4], /^> Item 6/);
			assert.match(before[row + 2], new RegExp(`Item ${4 + row} `));

			for (const y of [0, 1, 2, 3, 4, row]) {
				assert.strictEqual(list.handleMouse({ ...mouse("move", 1, y + 2), button: "none" }), undefined);
				assert.deepStrictEqual(list.render(80), before);
			}
			assert.deepStrictEqual(changes, []);

			list.handleMouse(mouse("press", 1, row + 2));
			list.render(80);
			list.handleMouse(mouse("click", 1, row + 2));
			assert.deepStrictEqual(changes, [{ id: `item-${4 + row}`, value: "on" }]);
		});
	}

	it("keeps a delegating overlay focused when its nested input is clicked", async () => {
		const terminal = new VirtualTerminal(20, 4);
		const tui = new TuiAltScreen(terminal);
		const overlay = new InputOverlay();
		overlay.input.setValue("hi");
		tui.start();
		tui.showOverlay(overlay, { anchor: "top-left", width: 20 });
		await terminal.waitForRender();

		terminal.sendInput("\x1b[<0;5;1M");
		terminal.sendInput("\x1b[<0;5;1m");
		terminal.sendInput("!");
		await terminal.waitForRender();

		assert.strictEqual(overlay.input.getValue(), "hi!");
		assert.strictEqual(tui.getFocusedComponent(), overlay);
		tui.stop();
	});

	it("positions and focuses the multiline editor through alternate-screen dispatch", async () => {
		const terminal = new VirtualTerminal(20, 6);
		const tui = new TuiAltScreen(terminal);
		const editor = new Editor(tui, editorTheme);
		editor.setText("hello");
		tui.addChild(editor);
		tui.start();
		await terminal.waitForRender();

		terminal.sendInput("\x1b[<0;3;2M");
		terminal.sendInput("\x1b[<0;3;2m");
		terminal.sendInput("X");
		await terminal.waitForRender();

		assert.strictEqual(editor.getText(), "heXllo");
		assert.strictEqual(tui.getFocusedComponent(), editor);
		tui.stop();
	});

	it("deletes a multiline mouse drag released just past the last character", async () => {
		const terminal = new VirtualTerminal(30, 8);
		const tui = new TuiAltScreen(terminal, undefined, undefined, { copyOnSelect: false });
		const editor = new Editor(tui, editorTheme);
		editor.setText("asdas\nASDSaddasdadsaa");
		tui.addChild(editor);
		tui.start();
		try {
			await terminal.waitForRender();
			const lines = terminal.getViewport();
			const first = lines.findIndex((line) => line.includes("asdas")) + 1;
			const last = lines.findIndex((line) => line.includes("ASDSaddasdadsaa")) + 1;
			assert.ok(first > 0 && last > first);
			terminal.sendInput(`\x1b[<0;1;${first}M`);
			terminal.sendInput(`\x1b[<32;16;${last}M`);
			terminal.sendInput(`\x1b[<0;16;${last}m`);
			await terminal.waitForRender();
			terminal.sendInput("\x7f");
			await terminal.waitForRender();
			assert.strictEqual(editor.getText(), "");
		} finally {
			tui.stop();
		}
	});

	it("uses a multiline drag released in editor-row padding instead of the old cursor", async () => {
		const terminal = new VirtualTerminal(30, 8);
		const tui = new TuiAltScreen(terminal, undefined, undefined, { copyOnSelect: false });
		const editor = new Editor(tui, editorTheme);
		editor.setText("one\ntwo");
		tui.addChild(editor);
		tui.setFocus(editor);
		tui.start();
		try {
			await terminal.waitForRender();
			const lines = terminal.getViewport();
			const first = lines.findIndex((line) => line.includes("one")) + 1;
			const last = lines.findIndex((line) => line.includes("two")) + 1;
			terminal.sendInput(`\x1b[<0;1;${first}M`);
			terminal.sendInput(`\x1b[<32;8;${last}M`);
			terminal.sendInput(`\x1b[<0;8;${last}m`);
			await terminal.waitForRender();
			terminal.sendInput("\x7f");
			assert.strictEqual(editor.getText(), "");
		} finally {
			tui.stop();
		}
	});

	it("deletes a reverse mouse selection pressed just after the last glyph", async () => {
		const terminal = new VirtualTerminal(30, 8);
		const tui = new TuiAltScreen(terminal, undefined, undefined, { copyOnSelect: false });
		const editor = new Editor(tui, editorTheme);
		editor.setText("first\nsecond\nthird");
		const container = new Container();
		container.addChild(editor);
		tui.setLayoutRoot(
			new VStack([
				{
					component: new ScrollView(new Text("transcript", 0, 0), { primary: true }),
					basis: 0,
					grow: 1,
					minSize: 1,
				},
				{ component: new VStack([{ component: container, shrink: 1, minSize: 3 }]), basis: "auto", minSize: 1 },
			]),
		);
		tui.setFocus(editor);
		tui.start();
		try {
			await terminal.waitForRender();
			const lines = terminal.getViewport();
			const second = lines.findIndex((line) => line.includes("second")) + 1;
			const third = lines.findIndex((line) => line.includes("third")) + 1;
			assert.ok(second > 0 && third > second);
			terminal.sendInput(`\x1b[<0;6;${third}M`);
			terminal.sendInput(`\x1b[<32;1;${second}M`);
			terminal.sendInput(`\x1b[<3;1;${second}m`);
			await terminal.waitForRender();
			assert.strictEqual(editor.getSelectedText(), "second\nthird");
			terminal.sendInput("\x7f");
			assert.strictEqual(editor.getText(), "first\n");
		} finally {
			tui.stop();
		}
	});

	it("deletes a reverse drag from the middle line's end to the first glyph", async () => {
		const terminal = new VirtualTerminal(30, 8);
		const tui = new TuiAltScreen(terminal, undefined, undefined, { copyOnSelect: false });
		const editor = new Editor(tui, editorTheme);
		editor.setText("first\nsecond\nthird");
		tui.addChild(editor);
		tui.setFocus(editor);
		tui.start();
		try {
			await terminal.waitForRender();
			const lines = terminal.getViewport();
			const first = lines.findIndex((line) => line.includes("first")) + 1;
			const second = lines.findIndex((line) => line.includes("second")) + 1;
			terminal.sendInput(`\x1b[<0;7;${second}M`);
			terminal.sendInput(`\x1b[<32;1;${first}M`);
			terminal.sendInput(`\x1b[<0;1;${first}m`);
			await terminal.waitForRender();
			assert.strictEqual(editor.getSelectedText(), "first\nsecond");
			terminal.sendInput("\x7f");
			assert.strictEqual(editor.getText(), "\nthird");
		} finally {
			tui.stop();
		}
	});

	it("maps a reverse drag pressed after a wide grapheme to its full line", async () => {
		const terminal = new VirtualTerminal(30, 8);
		const tui = new TuiAltScreen(terminal, undefined, undefined, { copyOnSelect: false });
		const editor = new Editor(tui, editorTheme);
		editor.setText("first\n你😀");
		tui.addChild(editor);
		tui.setFocus(editor);
		tui.start();
		try {
			await terminal.waitForRender();
			const lines = terminal.getViewport();
			const first = lines.findIndex((line) => line.includes("first")) + 1;
			const last = lines.findIndex((line) => line.includes("你😀")) + 1;
			terminal.sendInput(`\x1b[<0;5;${last}M`);
			terminal.sendInput(`\x1b[<32;1;${first}M`);
			terminal.sendInput(`\x1b[<0;1;${first}m`);
			await terminal.waitForRender();
			assert.strictEqual(editor.getSelectedText(), "first\n你😀");
			terminal.sendInput("\x7f");
			assert.strictEqual(editor.getText(), "");
		} finally {
			tui.stop();
		}
	});

	it("keeps drags started farther into editor-row padding screen-only", async () => {
		const terminal = new VirtualTerminal(30, 8);
		const tui = new TuiAltScreen(terminal, undefined, undefined, { copyOnSelect: false });
		const editor = new Editor(tui, editorTheme);
		editor.setText("first\nsecond\nthird");
		tui.addChild(editor);
		tui.setFocus(editor);
		tui.start();
		try {
			await terminal.waitForRender();
			const lines = terminal.getViewport();
			const second = lines.findIndex((line) => line.includes("second")) + 1;
			const third = lines.findIndex((line) => line.includes("third")) + 1;
			terminal.sendInput(`\x1b[<0;9;${third}M`);
			terminal.sendInput(`\x1b[<32;1;${second}M`);
			terminal.sendInput(`\x1b[<0;1;${second}m`);
			await terminal.waitForRender();
			assert.strictEqual(editor.getSelectedText(), undefined);
			assert.strictEqual(editor.getText(), "first\nsecond\nthird");
		} finally {
			tui.stop();
		}
	});

	it("deletes through an empty editor row without editing transcript text", async () => {
		const terminal = new VirtualTerminal(30, 8);
		const tui = new TuiAltScreen(terminal, undefined, undefined, { copyOnSelect: false });
		const editor = new Editor(tui, editorTheme);
		editor.setText("one\n");
		tui.addChild(editor);
		tui.start();
		try {
			await terminal.waitForRender();
			const first = terminal.getViewport().findIndex((line) => line.includes("one")) + 1;
			terminal.sendInput(`\x1b[<0;1;${first}M`);
			terminal.sendInput(`\x1b[<32;6;${first + 1}M`);
			terminal.sendInput(`\x1b[<0;6;${first + 1}m`);
			await terminal.waitForRender();
			terminal.sendInput("\x7f");
			assert.strictEqual(editor.getText(), "");
		} finally {
			tui.stop();
		}
	});

	it("selects and copies editor text on drag while making it editable", async () => {
		const terminal = new VirtualTerminal(20, 6);
		const copied: string[] = [];
		const tui = new TuiAltScreen(terminal, undefined, undefined, {
			copySelection: async (text) => {
				copied.push(text);
				return true;
			},
		});
		const editor = new Editor(tui, editorTheme);
		editor.setText("hello world");
		tui.addChild(editor);
		tui.start();
		await terminal.waitForRender();

		terminal.sendInput("\x1b[<0;1;2M");
		terminal.sendInput("\x1b[<32;5;2M");
		terminal.sendInput("\x1b[<0;5;2m");
		await terminal.waitForRender();

		assert.deepStrictEqual(copied, ["hello"]);
		editor.handleInput("\x7f");
		assert.strictEqual(editor.getText(), " world");
		tui.stop();
	});
});
