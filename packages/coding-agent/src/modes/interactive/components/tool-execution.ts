import {
	Box,
	type Component,
	Container,
	getCapabilities,
	Image,
	MouseRegion,
	Spacer,
	Text,
	type TUI,
	type TuiMouseEvent,
} from "@earendil-works/pi-tui";
import type {
	ToolDefinition,
	ToolRenderContext,
	ToolRendererProfile,
	ToolRenderers,
} from "../../../core/extensions/types.ts";

export type { ToolRenderers } from "../../../core/extensions/types.ts";

import { getTextOutput as getRenderedTextOutput } from "../../../core/tools/render-utils.ts";
import { convertToPng } from "../../../utils/image-convert.ts";
import { theme } from "../theme/theme.ts";
import { keyHint, keyText } from "./keybinding-hints.ts";

const FALLBACK_PREVIEW_LINES = 10;

export interface ToolExecutionOptions {
	showImages?: boolean;
	imageWidthCells?: number;
	/** Display-only frame for Pi-rendered built-in tool content. */
	rendererProfile?: ToolRendererProfile;
}

export class ToolExecutionComponent extends Container {
	private contentBox: Box;
	private contentText: Text;
	private contentTextRegion: MouseRegion;
	private renderRoot: Container;
	private selfRenderContainer: Container;
	private selfRenderHeight = 0;
	private callRendererComponent?: Component;
	private resultRendererComponent?: Component;
	private rendererState: any = {};
	private imageComponents: Image[] = [];
	private imageSpacers: Spacer[] = [];
	private toolName: string;
	private toolCallId: string;
	private args: any;
	private expanded = false;
	private showImages: boolean;
	private imageWidthCells: number;
	private isPartial = true;
	private toolDefinition?: ToolRenderers;
	private rendererProfile?: ToolRendererProfile;
	private ui: TUI;
	private cwd: string;
	private executionStarted = false;
	private argsComplete = false;
	private result?: {
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		isError: boolean;
		details?: any;
	};
	private convertedImages: Map<number, { data: string; mimeType: string }> = new Map();
	private hideComponent = false;

	constructor(
		toolName: string,
		toolCallId: string,
		args: any,
		options: ToolExecutionOptions = {},
		toolDefinition: ToolRenderers | ToolDefinition<any, any, any> | undefined,
		ui: TUI,
		cwd: string,
	) {
		super();
		this.toolName = toolName;
		this.toolCallId = toolCallId;
		this.args = args;
		this.toolDefinition = toolDefinition;
		this.rendererProfile = options.rendererProfile;
		this.showImages = options.showImages ?? true;
		this.imageWidthCells = options.imageWidthCells ?? 60;
		this.ui = ui;
		this.cwd = cwd;

		this.addChild(new Spacer(1));

		// Always create all shell variants. contentBox is used for default renderer-based composition.
		// selfRenderContainer is used when the tool renders its own framing.
		// contentText is reserved for generic fallback rendering when no tool definition exists.
		this.contentBox = new Box(1, 1, (text: string) => theme.bg("toolPendingBg", text));
		this.contentText = new Text("", 1, 1, (text: string) => theme.bg("toolPendingBg", text));
		this.contentTextRegion = this.createResultRegion(this.contentText);
		this.renderRoot = new Container();
		this.selfRenderContainer = new Container();
		this.addChild(this.renderRoot);

		this.updateDisplay();
	}

	private getCallRenderer(): ToolDefinition<any, any>["renderCall"] | undefined {
		return this.toolDefinition?.renderCall;
	}

	private getResultRenderer(): ToolDefinition<any, any>["renderResult"] | undefined {
		return this.toolDefinition?.renderResult;
	}

	private hasRendererDefinition(): boolean {
		return this.toolDefinition !== undefined;
	}

	private getRenderShell(): "default" | "self" {
		return this.toolDefinition?.renderShell ?? "default";
	}

	private getRenderContext(lastComponent: Component | undefined): ToolRenderContext {
		return {
			args: this.args,
			toolCallId: this.toolCallId,
			invalidate: () => {
				this.invalidate();
				this.ui.requestRender();
			},
			lastComponent,
			state: this.rendererState,
			cwd: this.cwd,
			executionStarted: this.executionStarted,
			argsComplete: this.argsComplete,
			isPartial: this.isPartial,
			expanded: this.expanded,
			showImages: this.showImages,
			isError: this.result?.isError ?? false,
		};
	}

	private createCallFallback(): Component {
		return new Text(theme.fg("toolTitle", theme.bold(this.toolName)), 0, 0);
	}

	private createResultFallback(): Component | undefined {
		const output = this.getTextOutput();
		if (!output) {
			return undefined;
		}

		const lines = output.split("\n");
		const displayLines = this.expanded ? lines : lines.slice(0, FALLBACK_PREVIEW_LINES);
		const remaining = lines.length - displayLines.length;
		let text = displayLines.map((line) => theme.fg("toolOutput", line)).join("\n");
		if (remaining > 0) {
			text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;
		}
		return new Text(text, 0, 0);
	}

	private createResultRegion(component: Component): MouseRegion {
		return new MouseRegion(component, (event) => {
			if (!this.result || event.type !== "click" || event.button !== "left") return undefined;
			this.setExpanded(!this.expanded);
			return { handled: true };
		});
	}

	getToolName(): string {
		return this.toolName;
	}

	/** Replace the display definition without changing this row's execution or result state. */
	setToolDefinition(toolDefinition: ToolRenderers | ToolDefinition<any, any, any> | undefined): void {
		this.toolDefinition = toolDefinition;
		this.updateDisplay();
		this.ui.requestRender();
	}

	/** Replace the display-only frame without changing this row's execution or result state. */
	setToolRendererProfile(rendererProfile: ToolRendererProfile | undefined): void {
		this.rendererProfile = rendererProfile;
		this.updateDisplay();
		this.ui.requestRender();
	}

	updateArgs(args: any): void {
		this.args = args;
		this.updateDisplay();
	}

	markExecutionStarted(): void {
		this.executionStarted = true;
		this.updateDisplay();
		this.ui.requestRender();
	}

	setArgsComplete(): void {
		this.argsComplete = true;
		this.updateDisplay();
		this.ui.requestRender();
	}

	updateResult(
		result: {
			content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
			details?: any;
			isError: boolean;
		},
		isPartial = false,
	): void {
		this.result = result;
		this.isPartial = isPartial;
		this.updateDisplay();
		this.maybeConvertImagesForKitty();
	}

	private maybeConvertImagesForKitty(): void {
		const caps = getCapabilities();
		if (caps.images !== "kitty") return;
		if (!this.result) return;

		const imageBlocks = this.result.content.filter((c) => c.type === "image");
		for (let i = 0; i < imageBlocks.length; i++) {
			const img = imageBlocks[i];
			if (!img.data || !img.mimeType) continue;
			if (img.mimeType === "image/png") continue;
			if (this.convertedImages.has(i)) continue;

			const index = i;
			convertToPng(img.data, img.mimeType).then((converted) => {
				if (converted) {
					this.convertedImages.set(index, converted);
					this.updateDisplay();
					this.ui.requestRender();
				}
			});
		}
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.updateDisplay();
	}

	setShowImages(show: boolean): void {
		this.showImages = show;
		this.updateDisplay();
	}

	setImageWidthCells(width: number): void {
		this.imageWidthCells = Math.max(1, Math.floor(width));
		this.updateDisplay();
	}

	override invalidate(): void {
		super.invalidate();
		this.updateDisplay();
	}

	override render(width: number): string[] {
		if (this.hideComponent) {
			return [];
		}

		if (this.hasRendererDefinition() && this.getRenderShell() === "self") {
			const contentLines = this.selfRenderContainer.render(width);
			this.selfRenderHeight = contentLines.length;
			if (contentLines.length === 0 && this.imageComponents.length === 0) {
				return [];
			}

			const lines: string[] = [];
			if (contentLines.length > 0) {
				lines.push("");
				lines.push(...contentLines);
			}
			for (let i = 0; i < this.imageComponents.length; i++) {
				const spacer = this.imageSpacers[i];
				if (spacer) {
					lines.push(...spacer.render(width));
				}
				const imageComponent = this.imageComponents[i];
				if (imageComponent) {
					lines.push(...imageComponent.render(width));
				}
			}
			return lines;
		}

		return super.render(width);
	}

	override handleMouse(event: TuiMouseEvent): ReturnType<Container["handleMouse"]> {
		if (!this.hasRendererDefinition() || this.getRenderShell() !== "self") return super.handleMouse(event);
		if (event.y <= 0 || event.y > this.selfRenderHeight) return undefined;
		return this.selfRenderContainer.handleMouse({
			...event,
			y: event.y - 1,
			height: this.selfRenderHeight,
		});
	}

	private updateDisplay(): void {
		const bgFn = this.isPartial
			? (text: string) => theme.bg("toolPendingBg", text)
			: this.result?.isError
				? (text: string) => theme.bg("toolErrorBg", text)
				: (text: string) => theme.bg("toolSuccessBg", text);

		let hasContent = false;
		this.hideComponent = false;
		this.renderRoot.clear();
		if (this.hasRendererDefinition()) {
			const renderContainer = this.getRenderShell() === "self" ? this.selfRenderContainer : this.contentBox;
			renderContainer.clear();
			if (renderContainer instanceof Box) {
				renderContainer.setBgFn(bgFn);
			}

			let call: Component;
			const callRenderer = this.getCallRenderer();
			if (!callRenderer) {
				call = this.createCallFallback();
			} else {
				try {
					call = callRenderer(this.args, theme, this.getRenderContext(this.callRendererComponent));
					this.callRendererComponent = call;
				} catch {
					this.callRendererComponent = undefined;
					call = this.createCallFallback();
				}
			}
			const callRegion = this.createResultRegion(call);
			hasContent = true;

			let result: Component | undefined;
			if (this.result) {
				const resultRenderer = this.getResultRenderer();
				if (!resultRenderer) {
					result = this.createResultFallback();
				} else {
					try {
						result = resultRenderer(
							{ content: this.result.content as any, details: this.result.details },
							{ expanded: this.expanded, isPartial: this.isPartial },
							theme,
							this.getRenderContext(this.resultRendererComponent),
						);
						this.resultRendererComponent = result;
					} catch {
						this.resultRendererComponent = undefined;
						result = this.createResultFallback();
					}
				}
			}
			const resultRegion = result && this.createResultRegion(result);

			if (this.rendererProfile && this.getRenderShell() !== "self") {
				const frameResult = this.result ? new Container() : undefined;
				if (frameResult && resultRegion) frameResult.addChild(resultRegion);
				if (frameResult) {
					for (const { spacer, image } of this.createImageComponents()) {
						frameResult.addChild(spacer);
						frameResult.addChild(image);
					}
				}
				try {
					this.renderRoot.addChild(
						this.rendererProfile.frame({
							call: callRegion,
							result: frameResult,
							state: this.isPartial ? "pending" : this.result?.isError ? "error" : "success",
							expandKeyText: keyText("app.tools.expand"),
						}),
					);
				} catch {
					renderContainer.addChild(callRegion);
					if (frameResult) renderContainer.addChild(frameResult);
					this.renderRoot.addChild(renderContainer);
				}
			} else {
				renderContainer.addChild(callRegion);
				if (resultRegion) renderContainer.addChild(resultRegion);
				this.renderRoot.addChild(renderContainer);
			}
		} else {
			this.contentText.setCustomBgFn(bgFn);
			this.contentText.setText(this.formatToolExecution());
			this.renderRoot.addChild(this.contentTextRegion);
			hasContent = true;
		}

		for (const img of this.imageComponents) {
			this.removeChild(img);
		}
		this.imageComponents = [];
		for (const spacer of this.imageSpacers) {
			this.removeChild(spacer);
		}
		this.imageSpacers = [];

		if (this.result && (!this.rendererProfile || this.getRenderShell() === "self")) {
			for (const { spacer, image } of this.createImageComponents()) {
				this.addChild(spacer);
				this.imageSpacers.push(spacer);
				this.imageComponents.push(image);
				this.addChild(image);
			}
		}

		if (this.hasRendererDefinition() && !hasContent && this.imageComponents.length === 0) {
			this.hideComponent = true;
		}
	}

	private createImageComponents(): Array<{ spacer: Spacer; image: Image }> {
		if (!this.result || !this.showImages) return [];
		const caps = getCapabilities();
		if (!caps.images) return [];

		const imageBlocks = this.result.content.filter((content) => content.type === "image");
		const components: Array<{ spacer: Spacer; image: Image }> = [];
		for (let i = 0; i < imageBlocks.length; i++) {
			const image = imageBlocks[i];
			if (!image?.data || !image.mimeType) continue;
			const converted = this.convertedImages.get(i);
			const imageData = converted?.data ?? image.data;
			const imageMimeType = converted?.mimeType ?? image.mimeType;
			if (caps.images === "kitty" && imageMimeType !== "image/png") continue;
			components.push({
				spacer: new Spacer(1),
				image: new Image(
					imageData,
					imageMimeType,
					{ fallbackColor: (text: string) => theme.fg("toolOutput", text) },
					{ maxWidthCells: this.imageWidthCells },
				),
			});
		}
		return components;
	}

	private getTextOutput(): string {
		return getRenderedTextOutput(this.result, this.showImages);
	}

	private formatToolExecution(): string {
		let text = theme.fg("toolTitle", theme.bold(this.toolName));
		const content = JSON.stringify(this.args, null, 2);
		if (content) {
			text += `\n\n${content}`;
		}
		const output = this.getTextOutput();
		if (output) {
			text += `\n${output}`;
		}
		return text;
	}
}
