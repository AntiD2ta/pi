import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(new URL("../test.sh", import.meta.url));

for (const workers of [undefined, "2", "0", "-1", "1.5", "invalid"]) {
	test(`isolated test runner validates worker count ${workers ?? "unset"}`, () => {
		const directory = mkdtempSync(join(tmpdir(), "pi-test-runner-"));
		const output = join(directory, "environment.json");
		try {
			writeFileSync(
				join(directory, "npm"),
				`#!/usr/bin/env node\nimport { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(output)}, JSON.stringify(process.env));\n`,
				{ mode: 0o755 },
			);
			const env = {
				...process.env,
				PATH: `${directory}${delimiter}${process.env.PATH}`,
				OPENAI_API_KEY: "test-secret-must-not-pass",
			};
			delete env.VITEST_MAX_WORKERS;
			if (workers !== undefined) env.VITEST_MAX_WORKERS = workers;
			const result = spawnSync("bash", [runner], { env, encoding: "utf8" });
			if (workers === undefined || workers === "2") {
				assert.equal(result.status, 0, result.stderr);
				const captured = JSON.parse(readFileSync(output, "utf8"));
				assert.equal(captured.VITEST_MAX_WORKERS, workers);
				assert.equal(captured.OPENAI_API_KEY, undefined);
				assert.equal(captured.PI_NO_LOCAL_LLM, "1");
			} else {
				assert.notEqual(result.status, 0);
				assert.match(result.stderr, /VITEST_MAX_WORKERS must be a positive integer/);
			}
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
}
