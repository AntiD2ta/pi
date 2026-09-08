import type { UsageReport, UsageReportFetcher, UsageWindow } from "../usage-reports.ts";
import { raceWithAbortSignal } from "../utils/abort.ts";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CACHE_DURATION_MS = 5 * 60_000;
const FIVE_HOURS_MS = 5 * 60 * 60_000;
const CLAUDE_CODE_USER_AGENT = "claude-cli/2.1.251";

type CacheEntry = {
	expiresAt: number;
	report: UsageReport | undefined;
};

type PendingRequest = {
	controller: AbortController;
	callers: number;
	request: Promise<UsageReport | undefined>;
};

type AnthropicUsageResponse = {
	five_hour?: {
		utilization?: unknown;
		resets_at?: unknown;
	} | null;
};

function parseFiveHourWindow(response: AnthropicUsageResponse, observedAt: number): UsageWindow | undefined {
	const window = response.five_hour;
	if (
		!window ||
		typeof window.utilization !== "number" ||
		!Number.isFinite(window.utilization) ||
		window.utilization < 0 ||
		window.utilization > 100 ||
		typeof window.resets_at !== "string"
	) {
		return undefined;
	}
	const resetsAt = Date.parse(window.resets_at);
	if (!Number.isFinite(resetsAt) || resetsAt <= observedAt) return undefined;
	return {
		duration: FIVE_HOURS_MS,
		used: window.utilization / 100,
		observedAt,
		resetsAt,
	};
}

export function createAnthropicUsageReportFetcher(): UsageReportFetcher {
	const cache = new Map<string, CacheEntry>();
	const pending = new Map<string, PendingRequest>();

	const fetchReport = async (accessToken: string, signal: AbortSignal): Promise<UsageReport | undefined> => {
		try {
			const response = await fetch(USAGE_URL, {
				headers: {
					Accept: "application/json",
					Authorization: `Bearer ${accessToken}`,
					"anthropic-beta": "oauth-2025-04-20",
					"User-Agent": CLAUDE_CODE_USER_AGENT,
				},
				signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
			});
			if (!response.ok) return undefined;
			const fiveHour = parseFiveHourWindow((await response.json()) as AnthropicUsageResponse, Date.now());
			return fiveHour ? { windows: [fiveHour] } : undefined;
		} catch {
			return undefined;
		}
	};

	return ({ accessToken, signal }) => {
		if (signal.aborted) return Promise.resolve(undefined);
		const cached = cache.get(accessToken);
		if (
			cached &&
			cached.expiresAt > Date.now() &&
			cached.report?.windows.every((window) => window.resetsAt > Date.now()) !== false
		) {
			return Promise.resolve(cached.report);
		}
		if (cached) cache.delete(accessToken);

		let pendingRequest = pending.get(accessToken);
		if (!pendingRequest) {
			const controller = new AbortController();
			const request = fetchReport(accessToken, controller.signal).then((report) => {
				cache.set(accessToken, { expiresAt: Date.now() + CACHE_DURATION_MS, report });
				return report;
			});
			pendingRequest = { controller, callers: 0, request };
			pending.set(accessToken, pendingRequest);
			void request.finally(() => pending.delete(accessToken));
		}
		pendingRequest.callers++;
		return raceWithAbortSignal(pendingRequest.request, signal)
			.catch(() => undefined)
			.finally(() => {
				if (--pendingRequest.callers === 0) pendingRequest.controller.abort();
			});
	};
}
