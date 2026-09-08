/**
 * Built-in tool renderers, without the tools themselves.
 *
 * A presentation displays tool calls and results; it does not execute them and does not need their
 * typebox parameter schemas. Importing this instead of `core/tools/index.ts` keeps ~17 MB of module
 * graph out of a process that only renders.
 */

import type { ToolRendererProfile, ToolRenderers } from "../../extensions/types.ts";
import type { ToolName } from "../index.ts";
import { createShellRenderers } from "./bash.ts";
import { editRenderers } from "./edit.ts";
import { findRenderers } from "./find.ts";
import { grepRenderers } from "./grep.ts";
import { lsRenderers } from "./ls.ts";
import { readRenderers } from "./read.ts";
import { writeRenderers } from "./write.ts";

export type { ToolRenderers } from "../../extensions/types.ts";

export {
	createShellRenderers,
	editRenderers,
	findRenderers,
	grepRenderers,
	lsRenderers,
	readRenderers,
	writeRenderers,
};

/** Renderers for every built-in tool, keyed by tool name. */
export function createAllToolRenderers(): Record<ToolName, ToolRenderers> {
	return {
		read: readRenderers,
		bash: createShellRenderers("$"),
		powershell: createShellRenderers("PS>"),
		edit: editRenderers,
		write: writeRenderers,
		grep: grepRenderers,
		find: findRenderers,
		ls: lsRenderers,
	};
}

/**
 * Merge built-in renderers into a tool definition that does not supply its own.
 *
 * `ToolExecutionComponent` used to do this lookup itself, which forced every presentation to import
 * the tool implementations. Callers do it now, so a process that renders can import renderers alone.
 */
export function withBuiltInRenderers<TDefinition extends ToolRenderers>(
	toolName: string,
	definition: TDefinition | undefined,
): TDefinition | ToolRenderers | undefined {
	const builtIn = createAllToolRenderers()[toolName as ToolName];
	if (!definition) return builtIn;
	if (!builtIn) return definition;
	return {
		...definition,
		renderCall: definition.renderCall ?? builtIn.renderCall,
		renderResult: definition.renderResult ?? builtIn.renderResult,
	};
}

/**
 * Resolve display slots without changing the executable tool definition. Explicit self-rendered
 * tools own their shell completely; otherwise each slot falls through independently.
 */
export function resolveToolRenderers(
	toolName: string,
	explicit: ToolRenderers | undefined,
	profile: ToolRendererProfile | undefined,
): ToolRenderers | undefined {
	if (explicit?.renderShell === "self") return explicit;
	const profileRenderers = profile?.tools[toolName];
	const builtIn = createAllToolRenderers()[toolName as ToolName];
	if (!explicit && !profileRenderers && !builtIn) return undefined;
	return {
		renderShell: explicit?.renderShell ?? profileRenderers?.renderShell,
		renderCall: explicit?.renderCall ?? profileRenderers?.renderCall ?? builtIn?.renderCall,
		renderResult: explicit?.renderResult ?? profileRenderers?.renderResult ?? builtIn?.renderResult,
	};
}
