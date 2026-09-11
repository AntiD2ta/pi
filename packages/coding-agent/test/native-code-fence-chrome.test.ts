import type { AssistantMessage } from "@earendil-works/pi-ai";
import { Container, type MarkdownCodeFenceChrome } from "@earendil-works/pi-tui";
import { describe, expect, test, vi } from "vitest";
import { AssistantMessageComponent } from "../src/modes/interactive/components/assistant-message.ts";
import { UserMessageComponent } from "../src/modes/interactive/components/user-message.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { OwnerOverrideSlot } from "../src/modes/interactive/ui-overrides.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

function createAssistantMessage(content: AssistantMessage["content"]): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "openai",
		model: "gpt-4o-mini",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

const chrome = (label: string): MarkdownCodeFenceChrome => ({
	header: () => [`[${label}]`],
	body: (lines) => lines,
	closing: () => ["</>"],
});

describe("native code fence chrome override", () => {
	test("refreshes user, assistant, and thinking fences and restores the preceding owner", () => {
		initTheme("dark");
		const overrides = new OwnerOverrideSlot<MarkdownCodeFenceChrome>();
		const getChrome = () => overrides.current?.value;
		const user = new UserMessageComponent("```typescript\nconst user = true;\n```", undefined, 1, [], getChrome);
		const assistant = new AssistantMessageComponent(
			createAssistantMessage([
				{ type: "thinking", thinking: "```typescript\nconst thought = true;\n```" },
				{ type: "text", text: "```typescript\nconst answer = true;\n```" },
			]),
			false,
			undefined,
			"Thinking...",
			1,
			[],
			getChrome,
		);
		const chatContainer = new Container();
		chatContainer.addChild(user);
		chatContainer.addChild(assistant);
		const invalidate = vi.spyOn(chatContainer, "invalidate");
		const fakeThis = Object.assign(Object.create(InteractiveMode.prototype), {
			codeFenceChromeOverrides: overrides,
			chatContainer,
			ui: { requestRender: vi.fn() },
			uiOverrideGeneration: 0,
		});
		const createExtensionUIContext = (
			InteractiveMode as unknown as {
				prototype: {
					createExtensionUIContext(this: typeof fakeThis): {
						setMarkdownCodeFenceChromeOverride(
							owner: object,
							value: MarkdownCodeFenceChrome | undefined,
						): { effectiveOwner: object | undefined };
					};
				};
			}
		).prototype.createExtensionUIContext;
		const ui = createExtensionUIContext.call(fakeThis);
		const ownerA = {};
		const ownerB = {};
		const render = () => stripAnsi(`${user.render(80).join("\n")}\n${assistant.render(80).join("\n")}`);

		expect(render()).not.toContain("[A]");

		ui.setMarkdownCodeFenceChromeOverride(ownerA, chrome("A"));
		expect(render().match(/\[A\]/g)).toHaveLength(3);
		expect(invalidate).toHaveBeenCalledTimes(1);

		ui.setMarkdownCodeFenceChromeOverride(ownerB, chrome("B"));
		ui.setMarkdownCodeFenceChromeOverride(ownerB, undefined);
		expect(render().match(/\[A\]/g)).toHaveLength(3);

		ui.setMarkdownCodeFenceChromeOverride(ownerB, chrome("B"));
		ui.setMarkdownCodeFenceChromeOverride(ownerA, undefined);
		expect(render().match(/\[B\]/g)).toHaveLength(3);

		ui.setMarkdownCodeFenceChromeOverride(ownerB, undefined);
		expect(render()).not.toContain("[A]");
		expect(render()).not.toContain("[B]");
		expect(invalidate).toHaveBeenCalledTimes(5);
	});
});
