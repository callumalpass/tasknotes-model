import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

test("publishes the runtime contract from ESM and CommonJS exports", async () => {
	const esm = await import("@tasknotes/model/runtime");
	const cjs = createRequire(import.meta.url)("@tasknotes/model/runtime");

	assert.equal(esm.MDBASE_RUNTIME_PROFILE_VERSION, "0.1.0");
	assert.equal(cjs.MDBASE_RUNTIME_PROFILE_VERSION, "0.1.0");
});
