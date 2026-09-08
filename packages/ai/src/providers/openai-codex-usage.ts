import type { UsageReport, UsageReportFetcher, UsageWindow } from "../usage-reports.ts";
import { raceWithAbortSignal } from "../utils/abort.ts";

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const CACHE_DURATION_MS = 5 * 60_000;

type CacheEntry = {
	expiresAt: number;
	report: UsageReport | undefined;
};

type PendingRequest = {
	controller: AbortController;
	callers: number;
	request: Promise<UsageReport | undefined>;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function parseWindow(value: unknown, observedAt: number): UsageWindow | undefined {
	const window = asRecord(value);
	if (!window) return undefined;
	const usedPercent = window.used_percent;
	const durationSeconds = window.limit_window_seconds;
	if (
		typeof usedPercent !== "number" ||
		!Number.isFinite(usedPercent) ||
		usedPercent < 0 ||
		usedPercent > 100 ||
		typeof durationSeconds !== "number" ||
		!Number.isFinite(durationSeconds) ||
		durationSeconds <= 0
	) {
		return undefined;
	}

	const resetAt = window.reset_at;
	const resetAfterSeconds = window.reset_after_seconds;
	const resetsAt =
		typeof resetAt === "number" && Number.isFinite(resetAt)
			? resetAt * 1000
			: typeof resetAfterSeconds === "number" && Number.isFinite(resetAfterSeconds)
				? observedAt + resetAfterSeconds * 1000
				: undefined;
	if (resetsAt === undefined || !Number.isFinite(resetsAt) || resetsAt <= observedAt) return undefined;
	const duration = durationSeconds * 1000;
	if (!Number.isFinite(duration)) return undefined;

	return {
		duration,
		used: usedPercent / 100,
		observedAt,
		resetsAt,
	};
}

function parseReport(response: unknown, observedAt: number): UsageReport | undefined {
	const body = asRecord(response);
	if (body?.plan_type !== "plus" && body?.plan_type !== "pro") return undefined;
	const credits = asRecord(body.credits);
	if (credits?.has_credits !== false || credits.unlimited !== false) return undefined;
	const rateLimit = asRecord(body.rate_limit);
	const windows = [
		parseWindow(rateLimit?.primary_window, observedAt),
		parseWindow(rateLimit?.secondary_window, observedAt),
	].filter((window): window is UsageWindow => window !== undefined);
	return windows.length > 0 ? { windows } : undefined;
}

export function createOpenAICodexUsageReportFetcher(): UsageReportFetcher {
	const cache = new Map<string, CacheEntry>();
	const pending = new Map<string, PendingRequest>();

	const fetchReport = async (
		accessToken: string,
		accountId: string,
		signal: AbortSignal,
	): Promise<UsageReport | undefined> => {
		try {
			const response = await fetch(USAGE_URL, {
				headers: {
					Accept: "application/json",
					Authorization: `Bearer ${accessToken}`,
					"chatgpt-account-id": accountId,
					originator: "codex_cli_rs",
				},
				signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
			});
			if (!response.ok) return undefined;
			return parseReport(await response.json(), Date.now());
		} catch {
			return undefined;
		}
	};

	return ({ accessToken, accountId, signal }) => {
		if (signal.aborted || !accountId) return Promise.resolve(undefined);
		const cached = cache.get(accountId);
		if (
			cached &&
			cached.expiresAt > Date.now() &&
			cached.report?.windows.every((window) => window.resetsAt > Date.now()) !== false
		) {
			return Promise.resolve(cached.report);
		}
		if (cached) cache.delete(accountId);

		let pendingRequest = pending.get(accountId);
		if (!pendingRequest) {
			const controller = new AbortController();
			const request = fetchReport(accessToken, accountId, controller.signal).then((report) => {
				cache.set(accountId, { expiresAt: Date.now() + CACHE_DURATION_MS, report });
				return report;
			});
			pendingRequest = { controller, callers: 0, request };
			pending.set(accountId, pendingRequest);
			void request.finally(() => pending.delete(accountId));
		}
		pendingRequest.callers++;
		return raceWithAbortSignal(pendingRequest.request, signal)
			.catch(() => undefined)
			.finally(() => {
				if (--pendingRequest.callers === 0) pendingRequest.controller.abort();
			});
	};
}
