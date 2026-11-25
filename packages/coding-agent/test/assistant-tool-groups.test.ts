import { type AssistantMessage, fauxAssistantMessage, fauxThinking, fauxToolCall } from "@earendil-works/pi-ai";
import { Container, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { describe, expect, test } from "vitest";
import { codemodeRenderers } from "../src/extensions/codemode/renderer.ts";
import { AssistantMessageComponent } from "../src/modes/interactive/components/assistant-message.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { ToolExecutionGroup } from "../src/modes/interactive/components/tool-execution-group.ts";
import { createInteractiveTui } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

describe("assistant tool groups", () => {
	test("labels mixed activity, sums final results, and shows cards only when expanded", () => {
		initTheme("dark");
		const ui = createInteractiveTui({ tuiMode: "fullscreen", showHardwareCursor: false, logDirectory: "/tmp" });
		const first = fauxToolCall("read", { path: "one.txt" });
		const second = fauxToolCall("grep", { path: "two.txt", pattern: "private pattern" });
		const firstCard = new ToolExecutionComponent(first.name, first.id, first.arguments, {}, undefined, ui, "/tmp");
		const secondCard = new ToolExecutionComponent(
			second.name,
			second.id,
			second.arguments,
			{},
			undefined,
			ui,
			"/tmp",
		);
		const group = new ToolExecutionGroup(false, 1);
		group.addCall(first, () => firstCard);
		group.addCall(second, () => secondCard);
		secondCard.updateResult({ content: [{ type: "text", text: "error!" }], isError: true, durationMs: 1800 });
		firstCard.updateResult({ content: [{ type: "text", text: "ignored partial result" }], isError: false }, true);
		const rendered = (width = 110) => stripAnsi(group.render(width).join("\n")).trim();
		expect(rendered()).toBe(
			"▸ Reading files and searching text · 2 calls · 1 failed · 1 pending · 1.8s tool time · ≈2 result tokens",
		);
		firstCard.updateResult({ content: [{ type: "text", text: "Payload" }], isError: false, durationMs: 600 });
		expect(rendered()).toBe(
			"▸ File reads and text searches · 2 calls · 1 failed · 2.4s tool time · ≈4 result tokens",
		);
		expect(group.render(110)[1]).toContain(theme.fg("syntaxOperator", "▸ File reads and text searches"));
		const click: TuiMouseEvent = {
			type: "click",
			button: "left",
			x: 1,
			y: 1,
			screenX: 1,
			screenY: 1,
			width: 110,
			height: 2,
			shift: false,
			alt: false,
			ctrl: false,
			clickCount: 1,
		};
		expect(group.handleMouse(click)?.handled).toBe(true);
		const expanded = rendered();
		expect(expanded).toContain("▾ File reads and text searches");
		expect(expanded).toContain("one.txt");
		expect(expanded).toContain("Payload");
		expect(expanded.indexOf("one.txt")).toBeLessThan(expanded.indexOf("two.txt"));
		expect(group.handleMouse(click)?.handled).toBe(true);
		expect(rendered()).not.toContain("Payload");
		expect(rendered(28)).toContain("2 calls · 1 failed");
		expect(rendered(14)).toContain("1 failed");
	});

	test("opens a codemode preview without expanding its output", () => {
		initTheme("dark");
		const width = 100;
		const ui = createInteractiveTui({ tuiMode: "fullscreen", showHardwareCursor: false, logDirectory: "/tmp" });
		const call = fauxToolCall("codemode", { code: "text('fixture');" });
		const tool = new ToolExecutionComponent(call.name, call.id, call.arguments, {}, codemodeRenderers, ui, "/tmp");
		const group = new ToolExecutionGroup(false, 1);
		group.addCall(call, () => tool);
		tool.updateResult({
			content: [
				{
					type: "text",
					text: ["first result", ...Array.from({ length: 24 }, () => "filler"), "last result"].join("\n"),
				},
			],
			isError: false,
		});
		const render = () => group.render(width).map(stripAnsi);
		const click = (y: number, height: number) =>
			group.handleMouse({
				type: "click",
				button: "left",
				x: 3,
				y,
				screenX: 3,
				screenY: y,
				width,
				height,
				shift: false,
				alt: false,
				ctrl: false,
				clickCount: 1,
			})?.handled;
		expect(click(1, render().length)).toBe(true);
		const preview = render();
		const firstResult = preview.findIndex((line) => line.includes("first result"));
		expect(firstResult).toBeGreaterThan(0);
		expect(preview.join("\n")).not.toContain("last result");
		expect(click(firstResult, preview.length)).toBe(true);
		expect(render().join("\n")).toContain("last result");
		group.setExpanded(false);
		expect(render().join("\n")).not.toContain("first result");
		group.setExpanded(true);
		expect(render().join("\n")).toContain("last result");
	});

	test("joins same-tool groups across empty thinking without absorbing a mixed group", () => {
		initTheme("dark");
		const width = 110;
		const ui = createInteractiveTui({ tuiMode: "fullscreen", showHardwareCursor: false, logDirectory: "/tmp" });
		const transcript = new Container();
		let previous: AssistantMessageComponent | undefined;
		const append = (content: AssistantMessage["content"]) => {
			const component = new AssistantMessageComponent(
				undefined,
				true,
				undefined,
				"",
				0,
				[],
				undefined,
				undefined,
				undefined,
				{
					leadingGroup: previous?.getTrailingToolGroup(),
					createTool: (call) => {
						const card = new ToolExecutionComponent(
							call.name,
							call.id,
							call.arguments,
							{},
							undefined,
							ui,
							"/tmp",
						);
						card.updateResult({ content: [{ type: "text", text: "result" }], isError: false, durationMs: 1000 });
						return card;
					},
					isExpanded: () => false,
				},
			);
			const message = fauxAssistantMessage(content, { stopReason: "toolUse" });
			component.updateContent(message, true);
			component.updateContent(message, false);
			transcript.addChild(component);
			previous = component;
		};
		const marker = { ...fauxThinking(""), thinkingSignature: "opaque fixture" };
		const script = (code: string) => fauxToolCall("codemode", { code });
		append([{ type: "text", text: "About to run scripts" }, script("first script")]);
		append([marker, script("second script"), marker]);
		append([script("third script")]);
		append([marker, script("mixed script")]);
		expect(stripAnsi(transcript.render(width).join("\n"))).toContain("Script runs · 4 calls");
		// The group after the last marker becomes mixed in a later assistant turn.
		append([fauxToolCall("bash", { command: "fixture" })]);

		const lines = transcript.render(width).map((line) => stripAnsi(line).trim());
		expect(lines).toEqual([
			"",
			"About to run scripts",
			"",
			"▸ Script runs · 3 calls · 0 failed · 3.0s tool time · ≈6 result tokens",
			"",
			"▸ Script runs and shell commands · 2 calls · 0 failed · 2.0s tool time · ≈4 result tokens",
		]);
		expect(
			transcript.handleMouse({
				type: "click",
				button: "left",
				x: 3,
				y: 3,
				screenX: 3,
				screenY: 3,
				width,
				height: lines.length,
				shift: false,
				alt: false,
				ctrl: false,
				clickCount: 1,
			})?.handled,
		).toBe(true);
		const expanded = stripAnsi(transcript.render(width).join("\n"));
		expect(expanded.indexOf("first script")).toBeGreaterThan(0);
		expect(expanded.indexOf("second script")).toBeGreaterThan(expanded.indexOf("first script"));
		expect(expanded.indexOf("third script")).toBeGreaterThan(expanded.indexOf("second script"));
		expect(expanded).not.toContain("mixed script");
	});

	test.each([
		{ name: "empty thinking", block: fauxThinking(" "), groups: 1 },
		{ name: "hidden non-empty thinking", block: fauxThinking("reasoning"), groups: 2 },
		{ name: "redacted thinking", block: { ...fauxThinking(""), redacted: true }, groups: 2 },
		{ name: "assistant prose", block: { type: "text" as const, text: "prose" }, groups: 2 },
	])("applies the boundary for $name within one message", ({ block, groups }) => {
		initTheme("dark");
		const ui = createInteractiveTui({ tuiMode: "fullscreen", showHardwareCursor: false, logDirectory: "/tmp" });
		const component = new AssistantMessageComponent(
			undefined,
			true,
			undefined,
			"",
			0,
			[],
			undefined,
			undefined,
			undefined,
			{
				createTool: (call) =>
					new ToolExecutionComponent(call.name, call.id, call.arguments, {}, undefined, ui, "/tmp"),
				isExpanded: () => false,
			},
		);
		const message = fauxAssistantMessage(
			[fauxToolCall("read", { path: "one" }), block, fauxToolCall("read", { path: "two" })],
			{ stopReason: "toolUse" },
		);
		component.updateContent(message);
		const summaries = component
			.render(80)
			.map(stripAnsi)
			.filter((line) => line.startsWith("▸ Reading files"));
		expect(summaries).toHaveLength(groups);
	});

	test("keeps groups in content order and splits at hidden thinking and text", () => {
		initTheme("dark");
		const ui = createInteractiveTui({ tuiMode: "fullscreen", showHardwareCursor: false, logDirectory: "/tmp" });
		const component = new AssistantMessageComponent(
			undefined,
			true,
			undefined,
			"",
			0,
			[],
			undefined,
			undefined,
			undefined,
			{
				createTool: (call) =>
					new ToolExecutionComponent(call.name, call.id, call.arguments, {}, undefined, ui, "/tmp"),
				isExpanded: () => false,
			},
		);
		const message = fauxAssistantMessage(
			[
				fauxToolCall("read", { path: "first" }),
				fauxToolCall("read", { path: "second" }),
				fauxThinking("hidden boundary"),
				fauxToolCall("bash", { command: "private command" }),
				{ type: "text", text: "Visible boundary" },
				fauxToolCall("custom_tool", { path: "fourth" }),
				fauxThinking("another hidden boundary"),
				fauxToolCall("find", { pattern: "*.ts" }),
				fauxToolCall("edit", { path: "fourth" }),
				fauxToolCall("ls", { path: "fourth" }),
			],
			{ stopReason: "toolUse" },
		);
		component.updateContent(message, true);
		const lines = component.render(80).map((line) => stripAnsi(line).trim());
		expect(lines[lines.indexOf("Visible boundary") + 1]).toBe("");
		expect(lines.filter(Boolean)).toEqual([
			"▸ Reading files · 2 calls · 2 pending",
			"▸ Running shell commands · 1 call · 1 pending",
			"Visible boundary",
			"▸ Running tools · 1 call · 1 pending",
			"▸ Running tools · 3 calls · 3 pending",
		]);
	});
});
