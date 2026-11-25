import { fauxAssistantMessage, fauxProvider, fauxThinking, fauxToolCall } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI): void {
	const faux = fauxProvider({ models: [{ id: "tool-groups", reasoning: true }] });
	const script = (label: string) => fauxToolCall("codemode", { code: `text(${JSON.stringify(label)})` });
	const marker = { ...fauxThinking(""), thinkingSignature: "fixture marker" };
	faux.setResponses([
		fauxAssistantMessage(
			[
				{ type: "text", text: "Checking two files." },
				fauxToolCall("read", { path: "fixture.txt" }),
				fauxToolCall("read", { path: "missing.txt" }),
				fauxThinking("The next tool tests stdout."),
				fauxToolCall("bash", { command: "sleep 0.2; printf 'GROUP_SECOND\n'" }),
				{ type: "text", text: "Checking one last file." },
				fauxToolCall("read", { path: "fixture.txt", offset: 2, limit: 1 }),
			],
			{ stopReason: "toolUse" },
		),
		fauxAssistantMessage([{ type: "text", text: "Checking repeated scripts." }, script("first script")], {
			stopReason: "toolUse",
		}),
		fauxAssistantMessage([marker, script("second script")], { stopReason: "toolUse" }),
		fauxAssistantMessage([marker, script("third script")], { stopReason: "toolUse" }),
		fauxAssistantMessage([marker, script("mixed script")], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("bash", { command: "printf 'MIXED_SHELL\n'" })], { stopReason: "toolUse" }),
		fauxAssistantMessage("Tool group trial done."),
	]);
	pi.registerProvider(faux.provider);
	pi.on("session_start", async () => {
		await pi.setModel(faux.getModel());
	});
}
