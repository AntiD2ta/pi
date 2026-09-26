import { unlinkSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";

vi.mock("../src/utils/clipboard-image.ts", () => ({
	readClipboardImage: async () => ({ bytes: new Uint8Array([137, 80, 78, 71]), mimeType: "image/png" }),
	extensionForImageMimeType: () => "png",
}));

describe("clipboard image markers", () => {
	it("sends the clipboard file path to the atomic editor when enabled", async () => {
		const insertImageMarker = vi.fn<(path: string) => void>();
		const insertTextAtCursor = vi.fn<(text: string) => void>();
		const context = {
			imageMarkersEnabled: true,
			editor: { insertImageMarker, insertTextAtCursor },
			ui: { requestRender: vi.fn() },
		};
		const prototype = InteractiveMode.prototype as unknown as {
			handleClipboardPaste(this: typeof context): Promise<void>;
		};
		await prototype.handleClipboardPaste.call(context);
		try {
			expect(insertImageMarker).toHaveBeenCalledOnce();
			expect(insertImageMarker.mock.calls[0]![0]).toMatch(/pi-clipboard-.*\.png$/);
			expect(insertTextAtCursor).not.toHaveBeenCalled();
		} finally {
			if (insertImageMarker.mock.calls[0]) unlinkSync(insertImageMarker.mock.calls[0][0]);
		}
	});
});
