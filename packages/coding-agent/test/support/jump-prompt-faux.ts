import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI): void {
	const faux = fauxProvider();
	faux.setResponses(
		[1, 2, 3, 4, 5, 6].map((number) =>
			fauxAssistantMessage(Array.from({ length: 12 }, (_, line) => `Reply ${number}, line ${line + 1}`).join("\n")),
		),
	);
	pi.registerProvider(faux.provider);
	pi.on("session_start", async () => {
		await pi.setModel(faux.getModel());
	});
}
