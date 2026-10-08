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

/** What this component needs from a tool: how to draw it, without executing it. */
export type { ToolRenderers };

import { formatToolCallWithArgs, getTextOutput as getRenderedTextOutput } from "../../../core/tools/render-utils.ts";
import { ensurePngTranscoder } from "../../../utils/image-convert.ts";
import { theme } from "../theme/theme.ts";
import { keyHint, keyText } from "./keybinding-hints.ts";

const FALLBACK_PREVIEW_LINES = 10;

export interface ToolExecutionOptions {
	showImages?: boolean;
	imageWidthCells?: number;
	/** Display-only frame for Pi-rendered built-in tool content. */
	rendererProfile?: ToolRendererProfile;
	outputPad?: number;
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
	/** Inputs of imageComponents, so updateDisplay can reuse images and keep their converted PNG data. */
	private imageSources: Array<{ data: string; mimeType: string; widthCells: number }> = [];
	private imageSpacers: Spacer[] = [];
	private toolName: string;
	private toolCallId: string;
	private args: any;
	private expanded = false;
	private showImages: boolean;
	private imageWidthCells: number;
	private outputPad: number;
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
		durationMs?: number;
	};
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
		this.outputPad = options.outputPad ?? 1;
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
			durationMs: this.isPartial ? undefined : this.result?.durationMs,
			outputPad: this.outputPad,
		};
	}

	private createCallFallback(): Component {
		return new Text(formatToolCallWithArgs(this.toolName, this.args, theme, this.expanded), 0, 0);
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
	setToolDefinition(
		toolDefinition: ToolRenderers | ToolDefinition<any, any, any> | undefined,
		rendererProfile: ToolRendererProfile | undefined,
	): void {
		this.toolDefinition = toolDefinition;
		this.rendererProfile = rendererProfile;
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
			/** Execution time of a final result. */
			durationMs?: number;
		},
		isPartial = false,
	): void {
		this.result = result;
		this.isPartial = isPartial;
		this.updateDisplay();
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.updateDisplay();
	}

	setOutputPad(outputPad: number): void {
		this.outputPad = outputPad;
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

		if (!this.rendererProfile && this.hasRendererDefinition() && this.getRenderShell() === "self") {
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
		if (this.rendererProfile || !this.hasRendererDefinition() || this.getRenderShell() !== "self") {
			return super.handleMouse(event);
		}
		if (event.y <= 0 || event.y > this.selfRenderHeight) return undefined;
		return this.selfRenderContainer.handleMouse({
			...event,
			y: event.y - 1,
			height: this.selfRenderHeight,
		});
	}

	private updateDisplay(): void {
		for (const image of this.imageComponents) this.removeChild(image);
		for (const spacer of this.imageSpacers) this.removeChild(spacer);
		const images = this.createImageComponents();
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
				renderContainer.setPaddingX(this.outputPad);
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

			if (this.rendererProfile) {
				const frameResult = this.result ? new Container() : undefined;
				if (frameResult && resultRegion) frameResult.addChild(resultRegion);
				if (frameResult) {
					for (const { spacer, image } of images) {
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
			this.contentText.setPaddingX(this.outputPad);
			this.contentText.setText(this.formatToolExecution());
			this.renderRoot.addChild(this.contentTextRegion);
			hasContent = true;
		}

		if (!this.rendererProfile || !this.hasRendererDefinition()) {
			for (const { spacer, image } of images) {
				this.addChild(spacer);
				this.addChild(image);
			}
		}

		if (this.hasRendererDefinition() && !hasContent && this.imageComponents.length === 0) {
			this.hideComponent = true;
		}
	}

	private createImageComponents(): Array<{ spacer: Spacer; image: Image }> {
		const previousImages = this.imageComponents;
		const previousSources = this.imageSources;
		this.imageComponents = [];
		this.imageSources = [];
		this.imageSpacers = [];
		if (!this.result || !this.showImages || !getCapabilities().images) return [];

		const components: Array<{ spacer: Spacer; image: Image }> = [];
		for (const block of this.result.content) {
			if (block.type !== "image" || !block.data || !block.mimeType) continue;
			const source = { data: block.data, mimeType: block.mimeType, widthCells: this.imageWidthCells };
			const index = this.imageComponents.length;
			const previous = previousSources[index];
			const image =
				previous?.data === source.data &&
				previous.mimeType === source.mimeType &&
				previous.widthCells === source.widthCells
					? previousImages[index]
					: new Image(
							source.data,
							source.mimeType,
							{ fallbackColor: (text: string) => theme.fg("toolOutput", text) },
							{ maxWidthCells: source.widthCells },
						);
			if (source.mimeType !== "image/png") {
				ensurePngTranscoder(() => {
					this.invalidate();
					this.ui.requestRender();
				});
			}
			const spacer = new Spacer(1);
			this.imageComponents.push(image);
			this.imageSources.push(source);
			this.imageSpacers.push(spacer);
			components.push({ spacer, image });
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
