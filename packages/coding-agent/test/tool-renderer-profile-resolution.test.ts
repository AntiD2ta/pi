import { Container, Text, type TUI } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { ToolRendererProfile, ToolRenderers } from "../src/core/extensions/types.ts";
import { createEditToolDefinition } from "../src/core/tools/edit.ts";
import { resolveToolRenderers } from "../src/core/tools/renderers/index.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

interface ResolutionContext {
	getExplicitToolDefinition(name: string): ToolRenderers | undefined;
	session: {
		getToolDefinition(name: string): ToolRenderers | ReturnType<typeof createEditToolDefinition> | undefined;
		extensionRunner: {
			resolveToolRenderers(name: string, next: () => ToolRenderers | undefined): ToolRenderers | undefined;
			getActiveToolRendererProfile(): ToolRendererProfile;
		};
	};
}

const resolve = (
	InteractiveMode.prototype as unknown as {
		getRegisteredToolDefinition(
			this: ResolutionContext,
			name: string,
		): {
			definition: ToolRenderers | undefined;
			rendererProfile: ToolRendererProfile | undefined;
		};
	}
).getRegisteredToolDefinition;

const profile: ToolRendererProfile = {
	frame: ({ call, result }) => {
		const frame = new Container();
		frame.addChild(call);
		if (result) frame.addChild(result);
		return frame;
	},
};

describe("native profile ownership through renderer middleware", () => {
	beforeAll(() => initTheme("dark"));

	for (const name of ["read", "bash", "powershell", "edit"]) {
		for (const mode of ["native", "transparent", "call", "result", "shell", "short-circuit", "mutate"] as const) {
			test(`${name}: ${mode}`, () => {
				const chain = vi.fn((_name: string, next: () => ToolRenderers | undefined) => {
					if (mode === "short-circuit") return { renderCall: () => new Text("MCP", 0, 0) };
					const native = next();
					if (mode === "call") return { ...native, renderCall: () => new Text("owned", 0, 0) };
					if (mode === "result") return { ...native, renderResult: () => new Text("owned", 0, 0) };
					if (mode === "shell")
						return {
							...native,
							renderShell: native?.renderShell === "self" ? ("default" as const) : ("self" as const),
						};
					if (mode === "mutate" && native) native.renderCall = () => new Text("owned", 0, 0);
					return mode === "transparent" ? { ...native } : native;
				});
				const context: ResolutionContext = {
					getExplicitToolDefinition: () => undefined,
					session: {
						getToolDefinition: () =>
							name === "edit"
								? createEditToolDefinition(process.cwd())
								: { ...resolveToolRenderers(name, undefined) },
						extensionRunner: { resolveToolRenderers: chain, getActiveToolRendererProfile: () => profile },
					},
				};
				const result = resolve.call(context, name);
				expect(chain).toHaveBeenCalledTimes(1);
				expect(result.definition).toBeDefined();
				expect(result.rendererProfile).toBe(mode === "native" || mode === "transparent" ? profile : undefined);
			});
		}
	}

	test.each(["native", "profile", "throwing profile"])("edit padding is applied once with %s", (mode) => {
		const context: ResolutionContext = {
			getExplicitToolDefinition: () => undefined,
			session: {
				getToolDefinition: () => createEditToolDefinition(process.cwd()),
				extensionRunner: {
					resolveToolRenderers: (_name, next) => next(),
					getActiveToolRendererProfile: () => profile,
				},
			},
		};
		const { definition, rendererProfile } = resolve.call(context, "edit");
		expect(definition?.renderShell).toBe("self");
		expect(rendererProfile).toBe(profile);
		const frame = vi.fn(profile.frame);
		const component = new ToolExecutionComponent(
			"edit",
			"edit-padding",
			{ path: "file.txt" },
			{
				outputPad: 0,
				rendererProfile:
					mode === "native"
						? undefined
						: mode === "profile"
							? { frame }
							: {
									frame: () => {
										throw new Error("frame failed");
									},
								},
			},
			definition,
			{ requestRender: () => {} } as unknown as TUI,
			process.cwd(),
		);
		component.updateResult({ content: [{ type: "text", text: "Could not find old text" }], isError: true });
		const lines = component
			.render(60)
			.map((line) => stripAnsi(line).trimEnd())
			.filter((line) => line.length > 0);
		expect(lines).toEqual(["edit file.txt", "Could not find old text"]);
		component.setOutputPad(1);
		expect(
			component
				.render(60)
				.map((line) => stripAnsi(line).trimEnd())
				.filter((line) => line.length > 0),
		).toEqual(lines.map((line) => ` ${line}`));
		if (mode === "profile") expect(frame).toHaveBeenCalled();
	});

	test("explicit definitions reusing native slots still own their rendering", () => {
		const context: ResolutionContext = {
			getExplicitToolDefinition: () => resolveToolRenderers("read", undefined),
			session: {
				getToolDefinition: () => resolveToolRenderers("read", undefined),
				extensionRunner: {
					resolveToolRenderers: (_name, next) => next(),
					getActiveToolRendererProfile: () => profile,
				},
			},
		};
		expect(resolve.call(context, "read").rendererProfile).toBeUndefined();
	});
});
