import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryCredentialStore } from "../src/auth/credential-store.ts";
import { createModels } from "../src/models.ts";
import { anthropicProvider } from "../src/providers/anthropic.ts";
import { openaiCodexProvider } from "../src/providers/openai-codex.ts";

vi.mock("../src/providers/anthropic.models.ts", () => ({ ANTHROPIC_MODELS: {} }));
vi.mock("../src/providers/openai-codex.models.ts", () => ({ OPENAI_CODEX_MODELS: {} }));

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function createAnthropicModels() {
	const credentials = new InMemoryCredentialStore();
	const models = createModels({ credentials });
	models.setProvider(anthropicProvider());
	return { credentials, models };
}

function createOpenAICodexModels() {
	const credentials = new InMemoryCredentialStore();
	const models = createModels({ credentials });
	models.setProvider(openaiCodexProvider());
	return { credentials, models };
}

describe.sequential("Models.getUsageReport", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it("normalizes Anthropic's five-hour OAuth window", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({
				five_hour: { utilization: 42.5, resets_at: "2026-09-08T18:00:00Z" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-09-08T17:00:00Z"));
		const { credentials, models } = createAnthropicModels();
		const observedAt = Date.now();
		await credentials.modify("anthropic", async () => ({
			type: "oauth",
			access: "oauth-access-token",
			refresh: "refresh-token",
			expires: observedAt + 10 * 60_000,
		}));

		await expect(models.getUsageReport("anthropic")).resolves.toEqual({
			windows: [
				{
					duration: 5 * 60 * 60_000,
					used: 0.425,
					observedAt,
					resetsAt: Date.parse("2026-09-08T18:00:00Z"),
				},
			],
		});
		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.anthropic.com/api/oauth/usage",
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer oauth-access-token",
					"anthropic-beta": "oauth-2025-04-20",
					"User-Agent": "claude-cli/2.1.251",
				}),
			}),
		);
	});

	it("normalizes a five-hour Codex window when it is secondary", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({
				plan_type: "plus",
				rate_limit: {
					allowed: true,
					limit_reached: false,
					primary_window: { used_percent: 20, reset_at: 1_789_800_000, limit_window_seconds: 604_800 },
					secondary_window: { used_percent: 42.5, reset_at: 1_789_221_600, limit_window_seconds: 18_000 },
				},
				credits: { has_credits: false, unlimited: false, balance: "0" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-09-08T17:00:00Z"));
		const { credentials, models } = createOpenAICodexModels();
		const observedAt = Date.now();
		await credentials.modify("openai-codex", async () => ({
			type: "oauth",
			access: "oauth-access-token",
			refresh: "refresh-token",
			expires: observedAt + 10 * 60_000,
			accountId: "account-1",
		}));

		await expect(models.getUsageReport("openai-codex")).resolves.toEqual({
			windows: [
				{
					duration: 7 * 24 * 60 * 60_000,
					used: 0.2,
					observedAt,
					resetsAt: 1_789_800_000_000,
				},
				{
					duration: 5 * 60 * 60_000,
					used: 0.425,
					observedAt,
					resetsAt: 1_789_221_600_000,
				},
			],
		});
		expect(fetchMock).toHaveBeenCalledWith(
			"https://chatgpt.com/backend-api/wham/usage",
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer oauth-access-token",
					"chatgpt-account-id": "account-1",
					originator: "codex_cli_rs",
				}),
			}),
		);
	});

	it("normalizes a relative Codex reset from the injected clock", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({
				plan_type: "pro",
				rate_limit: {
					primary_window: { used_percent: 10, reset_after_seconds: 3_600, limit_window_seconds: 18_000 },
				},
				credits: { has_credits: false, unlimited: false, balance: "0" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-09-08T17:00:00Z"));
		const { credentials, models } = createOpenAICodexModels();
		const observedAt = Date.now();
		await credentials.modify("openai-codex", async () => ({
			type: "oauth",
			access: "oauth-access-token",
			refresh: "refresh-token",
			expires: observedAt + 10 * 60_000,
			accountId: "account-1",
		}));

		await expect(models.getUsageReport("openai-codex")).resolves.toEqual({
			windows: [
				{
					duration: 5 * 60 * 60_000,
					used: 0.1,
					observedAt,
					resetsAt: observedAt + 60 * 60_000,
				},
			],
		});
	});

	it("rejects ineligible and malformed Codex responses without requesting missing account context", async () => {
		const fetchMock = vi
			.fn<() => Promise<Response>>()
			.mockResolvedValueOnce(
				jsonResponse({
					plan_type: "enterprise",
					rate_limit: {
						primary_window: { used_percent: 10, reset_at: 1_789_221_600, limit_window_seconds: 18_000 },
					},
					credits: { has_credits: false, unlimited: false, balance: "0" },
				}),
			)
			.mockResolvedValueOnce(
				jsonResponse({
					plan_type: "plus",
					rate_limit: {
						primary_window: { used_percent: 10, reset_at: 1_789_221_600, limit_window_seconds: 18_000 },
					},
					credits: { has_credits: true, unlimited: false, balance: "5" },
				}),
			)
			.mockResolvedValueOnce(
				jsonResponse({
					plan_type: "pro",
					rate_limit: {
						primary_window: { used_percent: 10, reset_at: 1_789_221_600, limit_window_seconds: 18_000 },
					},
					credits: { has_credits: false, unlimited: true, balance: "0" },
				}),
			)
			.mockResolvedValueOnce(
				jsonResponse({
					plan_type: "plus",
					rate_limit: {
						primary_window: { used_percent: 10, reset_at: 1_789_221_600, limit_window_seconds: Number.MAX_VALUE },
					},
					credits: { has_credits: false, unlimited: false, balance: "0" },
				}),
			)
			.mockResolvedValueOnce(jsonResponse({ plan_type: "pro", credits: { has_credits: false, unlimited: false } }));
		vi.stubGlobal("fetch", fetchMock);
		const { credentials, models } = createOpenAICodexModels();

		for (const [access, accountId] of [
			["enterprise-access", "enterprise-account"],
			["credit-access", "credit-account"],
			["unlimited-access", "unlimited-account"],
			["invalid-duration-access", "invalid-duration-account"],
			["malformed-access", "malformed-account"],
			["missing-account-access", undefined],
		] as const) {
			await credentials.modify("openai-codex", async () => ({
				type: "oauth",
				access,
				refresh: "refresh-token",
				expires: Date.now() + 10 * 60_000,
				...(accountId ? { accountId } : {}),
			}));
			await expect(models.getUsageReport("openai-codex")).resolves.toBeUndefined();
		}
		expect(fetchMock).toHaveBeenCalledTimes(5);
	});

	it("silently handles Codex cancellation and failed responses", async () => {
		const fetchMock = vi
			.fn<() => Promise<Response>>()
			.mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, 401))
			.mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, 429))
			.mockResolvedValueOnce(jsonResponse({ error: "server error" }, 500))
			.mockResolvedValueOnce(new Response("not JSON", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		const { credentials, models } = createOpenAICodexModels();
		const controller = new AbortController();
		controller.abort();
		await credentials.modify("openai-codex", async () => ({
			type: "oauth",
			access: "cancelled-access",
			refresh: "refresh-token",
			expires: Date.now() + 10 * 60_000,
			accountId: "cancelled-account",
		}));
		await expect(models.getUsageReport("openai-codex", { signal: controller.signal })).resolves.toBeUndefined();

		for (const [access, accountId] of [
			["unauthorized-access", "unauthorized-account"],
			["rate-limited-access", "rate-limited-account"],
			["server-error-access", "server-error-account"],
			["malformed-json-access", "malformed-json-account"],
		] as const) {
			await credentials.modify("openai-codex", async () => ({
				type: "oauth",
				access,
				refresh: "refresh-token",
				expires: Date.now() + 10 * 60_000,
				accountId,
			}));
			await expect(models.getUsageReport("openai-codex")).resolves.toBeUndefined();
		}
		expect(fetchMock).toHaveBeenCalledTimes(4);
	});

	it("silently returns unavailable when the Codex usage request times out", async () => {
		const fetchMock = vi.fn(
			(_url: string, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => reject(new DOMException("Timed out", "AbortError")), {
						once: true,
					});
				}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const { credentials, models } = createOpenAICodexModels();
		await credentials.modify("openai-codex", async () => ({
			type: "oauth",
			access: "oauth-access-token",
			refresh: "refresh-token",
			expires: Date.now() + 10 * 60_000,
			accountId: "account-1",
		}));

		await expect(models.getUsageReport("openai-codex")).resolves.toBeUndefined();
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("reuses Codex usage across token rotation but not account switching", async () => {
		const fetchMock = vi
			.fn<() => Promise<Response>>()
			.mockResolvedValueOnce(
				jsonResponse({
					plan_type: "plus",
					rate_limit: {
						primary_window: { used_percent: 10, reset_at: 1_789_221_600, limit_window_seconds: 18_000 },
					},
					credits: { has_credits: false, unlimited: false, balance: "0" },
				}),
			)
			.mockResolvedValueOnce(
				jsonResponse({
					plan_type: "pro",
					rate_limit: {
						primary_window: { used_percent: 20, reset_at: 1_789_221_600, limit_window_seconds: 18_000 },
					},
					credits: { has_credits: false, unlimited: false, balance: "0" },
				}),
			);
		vi.stubGlobal("fetch", fetchMock);
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-09-08T17:00:00Z"));
		const { credentials, models } = createOpenAICodexModels();
		await credentials.modify("openai-codex", async () => ({
			type: "oauth",
			access: "first-token",
			refresh: "refresh-token",
			expires: Date.now() + 10 * 60_000,
			accountId: "account-1",
		}));
		expect((await models.getUsageReport("openai-codex"))?.windows[0]?.used).toBe(0.1);
		await credentials.modify("openai-codex", async () => ({
			type: "oauth",
			access: "rotated-token",
			refresh: "refresh-token",
			expires: Date.now() + 10 * 60_000,
			accountId: "account-1",
		}));
		expect((await models.getUsageReport("openai-codex"))?.windows[0]?.used).toBe(0.1);
		await credentials.modify("openai-codex", async () => ({
			type: "oauth",
			access: "other-account-token",
			refresh: "refresh-token",
			expires: Date.now() + 10 * 60_000,
			accountId: "account-2",
		}));
		expect((await models.getUsageReport("openai-codex"))?.windows[0]?.used).toBe(0.2);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("shares one in-flight Codex request for concurrent callers", async () => {
		let respond: ((response: Response) => void) | undefined;
		const fetchMock = vi.fn(
			() =>
				new Promise<Response>((resolve) => {
					respond = resolve;
				}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const { credentials, models } = createOpenAICodexModels();
		await credentials.modify("openai-codex", async () => ({
			type: "oauth",
			access: "oauth-access-token",
			refresh: "refresh-token",
			expires: Date.now() + 10 * 60_000,
			accountId: "account-1",
		}));

		const first = models.getUsageReport("openai-codex");
		const second = models.getUsageReport("openai-codex");
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
		respond?.(
			jsonResponse({
				plan_type: "plus",
				rate_limit: {
					primary_window: { used_percent: 42.5, reset_at: 4_072_992_800, limit_window_seconds: 18_000 },
				},
				credits: { has_credits: false, unlimited: false, balance: "0" },
			}),
		);
		await expect(Promise.all([first, second])).resolves.toHaveLength(2);
	});

	it("reuses a report for five minutes without sharing it between OAuth accounts", async () => {
		const fetchMock = vi
			.fn<() => Promise<Response>>()
			.mockResolvedValueOnce(jsonResponse({ five_hour: { utilization: 10, resets_at: "2026-09-08T18:00:00Z" } }))
			.mockResolvedValueOnce(jsonResponse({ five_hour: { utilization: 20, resets_at: "2026-09-08T18:00:00Z" } }))
			.mockResolvedValueOnce(jsonResponse({ five_hour: { utilization: 30, resets_at: "2026-09-08T18:00:00Z" } }));
		vi.stubGlobal("fetch", fetchMock);
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-09-08T17:00:00Z"));
		const { credentials, models } = createAnthropicModels();
		await credentials.modify("anthropic", async () => ({
			type: "oauth",
			access: "first-account",
			refresh: "refresh-token",
			expires: Date.now() + 20 * 60_000,
		}));

		expect((await models.getUsageReport("anthropic"))?.windows[0]?.used).toBe(0.1);
		vi.advanceTimersByTime(4 * 60_000);
		expect((await models.getUsageReport("anthropic"))?.windows[0]?.used).toBe(0.1);
		vi.advanceTimersByTime(60_000);
		expect((await models.getUsageReport("anthropic"))?.windows[0]?.used).toBe(0.2);
		await credentials.modify("anthropic", async () => ({
			type: "oauth",
			access: "second-account",
			refresh: "refresh-token",
			expires: Date.now() + 10 * 60_000,
		}));
		expect((await models.getUsageReport("anthropic"))?.windows[0]?.used).toBe(0.3);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it("shares one in-flight request for concurrent callers", async () => {
		let respond: ((response: Response) => void) | undefined;
		const fetchMock = vi.fn(
			() =>
				new Promise<Response>((resolve) => {
					respond = resolve;
				}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const { credentials, models } = createAnthropicModels();
		await credentials.modify("anthropic", async () => ({
			type: "oauth",
			access: "oauth-access-token",
			refresh: "refresh-token",
			expires: Date.now() + 10 * 60_000,
		}));

		const first = models.getUsageReport("anthropic");
		const second = models.getUsageReport("anthropic");
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
		respond?.(jsonResponse({ five_hour: { utilization: 42.5, resets_at: "2099-09-08T18:00:00Z" } }));
		await expect(Promise.all([first, second])).resolves.toHaveLength(2);
	});

	it("does not request usage for API-key credentials", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const { credentials, models } = createAnthropicModels();
		await credentials.modify("anthropic", async () => ({ type: "api_key", key: "api-key" }));
		await expect(models.getUsageReport("anthropic")).resolves.toBeUndefined();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("silently returns unavailable when an OAuth caller has already cancelled", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const { credentials, models } = createAnthropicModels();
		await credentials.modify("anthropic", async () => ({
			type: "oauth",
			access: "oauth-access-token",
			refresh: "refresh-token",
			expires: Date.now() + 10 * 60_000,
		}));
		const controller = new AbortController();
		controller.abort();
		await expect(models.getUsageReport("anthropic", { signal: controller.signal })).resolves.toBeUndefined();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("silently rejects invalid, elapsed, and failed usage responses", async () => {
		const fetchMock = vi
			.fn<() => Promise<Response>>()
			.mockResolvedValueOnce(jsonResponse({ five_hour: { utilization: -1, resets_at: "2099-09-08T18:00:00Z" } }))
			.mockResolvedValueOnce(jsonResponse({ five_hour: { utilization: 1, resets_at: "2000-09-08T18:00:00Z" } }))
			.mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, 429));
		vi.stubGlobal("fetch", fetchMock);
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-09-08T17:00:00Z"));
		const { credentials, models } = createAnthropicModels();
		await credentials.modify("anthropic", async () => ({
			type: "oauth",
			access: "first-account",
			refresh: "refresh-token",
			expires: Date.now() + 10 * 60_000,
		}));
		await expect(models.getUsageReport("anthropic")).resolves.toBeUndefined();
		await credentials.modify("anthropic", async () => ({
			type: "oauth",
			access: "second-account",
			refresh: "refresh-token",
			expires: Date.now() + 10 * 60_000,
		}));
		await expect(models.getUsageReport("anthropic")).resolves.toBeUndefined();
		await credentials.modify("anthropic", async () => ({
			type: "oauth",
			access: "third-account",
			refresh: "refresh-token",
			expires: Date.now() + 10 * 60_000,
		}));
		await expect(models.getUsageReport("anthropic")).resolves.toBeUndefined();
	});
});
