import type { ToolCall } from "@earendil-works/pi-ai";
import { Container, MouseRegion, Spacer, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { formatToolDuration } from "../../../core/tools/render-utils.ts";
import { theme } from "../theme/theme.ts";
import { formatTokens } from "./footer.ts";
import type { ToolExecutionComponent } from "./tool-execution.ts";

type ToolActivity = readonly [working: string, settled: string];

const SHELL_ACTIVITY: ToolActivity = ["running shell commands", "shell commands"];
const GENERIC_ACTIVITY: ToolActivity = ["running tools", "tool activity"];
const TOOL_ACTIVITIES = new Map<string, ToolActivity>([
	["read", ["reading files", "file reads"]],
	["grep", ["searching text", "text searches"]],
	["find", ["finding files", "file searches"]],
	["ls", ["listing directories", "directory listings"]],
	["edit", ["editing files", "file edits"]],
	["write", ["writing files", "file writes"]],
	["bash", SHELL_ACTIVITY],
	["powershell", SHELL_ACTIVITY],
	["codemode", ["running scripts", "script runs"]],
]);

/** A consecutive run of tool calls, with a clickable summary above its existing cards. */
export class ToolExecutionGroup extends Container {
	private calls = new Map<string, ToolExecutionComponent>();
	private onlyTool?: string;
	private preceding?: ToolExecutionGroup;
	private following?: ToolExecutionGroup;
	private activities = new Set<ToolActivity>();
	private details = new Container();
	private label: Text;
	private expanded: boolean;
	private padding: number;

	constructor(expanded: boolean, padding: number) {
		super();
		this.expanded = expanded;
		this.padding = padding;
		this.label = new Text("", padding, 0);
		this.addChild(new Spacer(1));
		this.addChild(
			new MouseRegion(this.label, (event) => {
				if (event.type !== "click" || event.button !== "left") return undefined;
				this.setOpen(!this.expanded);
				return { handled: true };
			}),
		);
		if (expanded) this.addChild(this.details);
	}

	addCall(call: ToolCall, createTool: (call: ToolCall) => ToolExecutionComponent): void {
		if (this.calls.has(call.id)) return;
		const tool = createTool(call);
		if (this.calls.size === 0) this.onlyTool = call.name;
		else if (this.onlyTool !== call.name) this.onlyTool = undefined;
		this.calls.set(call.id, tool);
		this.activities.add(TOOL_ACTIVITIES.get(call.name) ?? GENERIC_ACTIVITY);
	}

	/** Join these rows only while both groups still contain the same single tool. */
	setPrecedingGroup(preceding: ToolExecutionGroup | undefined): void {
		if (this.preceding === preceding) return;
		if (this.preceding?.following === this) this.preceding.following = undefined;
		this.preceding = preceding;
		if (preceding) preceding.following = this;
	}

	getCalls(): Iterable<ToolExecutionComponent> {
		return this.calls.values();
	}

	/** The bulk shortcut changes card output as well as group visibility. */
	setExpanded(expanded: boolean): void {
		for (const tool of this.calls.values()) tool.setExpanded(expanded);
		this.setOpen(expanded);
	}

	private setOpen(expanded: boolean): void {
		if (expanded === this.expanded) return;
		this.expanded = expanded;
		if (expanded) this.addChild(this.details);
		else {
			this.removeChild(this.details);
			this.details.clear();
		}
	}

	setOutputPad(padding: number): void {
		this.padding = padding;
		this.label.setPaddingX(padding);
		for (const tool of this.calls.values()) tool.setOutputPad(padding);
	}

	override invalidate(): void {
		this.label.invalidate();
		for (const tool of this.calls.values()) tool.invalidate();
	}

	override render(width: number): string[] {
		if (this.joinsPrecedingGroup()) return [];
		if (this.expanded) this.details.clear();
		let count = 0;
		let finished = 0;
		let failed = 0;
		let duration = 0;
		let timed = 0;
		let tokens = 0;
		for (const tool of this.visibleCalls()) {
			count++;
			if (this.expanded) this.details.addChild(tool);
			const summary = tool.getSummary();
			if (!summary) continue;
			finished++;
			if (summary.isError) failed++;
			if (summary.durationMs !== undefined) {
				timed++;
				duration += summary.durationMs;
			}
			tokens += summary.resultTokens;
		}
		const pending = count - finished;
		const callCount = theme.fg("muted", `${count} call${count === 1 ? "" : "s"}`);
		const failures = failed || !pending ? theme.fg(failed ? "error" : "muted", `${failed} failed`) : "";
		const progress = pending ? theme.fg("muted", `${pending} pending`) : "";
		const separator = " · ";
		const facts = [callCount, failures, progress].filter(Boolean);
		const contentWidth = Math.max(1, width - 2 * this.padding);
		const titleWidth = contentWidth - visibleWidth(facts.join(separator)) - separator.length;
		const marker = this.expanded ? "▾" : "▸";
		const showActivity = titleWidth > 2;
		const title = theme.fg(
			"syntaxOperator",
			showActivity ? truncateToWidth(`${marker} ${this.getActivityLabel(pending > 0)}`, titleWidth) : marker,
		);
		// If the title has no room, show failures before other stats.
		const fields = !showActivity && failed ? [failures, callCount, progress].filter(Boolean) : facts;
		if (timed) {
			const coverage = timed < finished ? ` (${timed}/${finished} timed)` : "";
			fields.push(theme.fg("muted", `${formatToolDuration(duration)} tool time${coverage}`));
		}
		if (finished) fields.push(theme.fg("muted", `≈${formatTokens(tokens)} result tokens`));
		let label = title;
		for (const field of fields) {
			const joiner = !showActivity && label === title ? " " : separator;
			const candidate = label + joiner + field;
			if (visibleWidth(candidate) <= contentWidth) label = candidate;
		}
		this.label.setText(label);
		return super.render(width);
	}

	private joinsPrecedingGroup(): boolean {
		return (
			this.onlyTool !== undefined && this.preceding?.following === this && this.preceding.onlyTool === this.onlyTool
		);
	}

	private *visibleCalls(): Iterable<ToolExecutionComponent> {
		// Keep each group's calls in place: a later call can turn the following group into a mixed group.
		let group: ToolExecutionGroup | undefined = this;
		while (group) {
			yield* group.calls.values();
			group = group.following?.joinsPrecedingGroup() ? group.following : undefined;
		}
	}

	private getActivityLabel(working: boolean): string {
		const activities =
			this.activities.has(GENERIC_ACTIVITY) || this.activities.size > 2 ? [GENERIC_ACTIVITY] : this.activities;
		const text = Array.from(activities, (activity) => activity[working ? 0 : 1]).join(" and ");
		return text.charAt(0).toUpperCase() + text.slice(1);
	}
}
