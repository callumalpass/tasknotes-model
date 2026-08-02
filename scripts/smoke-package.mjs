import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dirname, "..");
const tempRoot = mkdtempSync(join(tmpdir(), "tasknotes-model-package-smoke-"));
let tarball;

function runNpm(args, options) {
  if (process.env.npm_execpath) {
    return execFileSync(process.execPath, [process.env.npm_execpath, ...args], options);
  }
  return execFileSync("npm", args, { ...options, shell: process.platform === "win32" });
}

try {
  const packed = JSON.parse(
    runNpm(["pack", "--json"], {
      cwd: packageRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    }),
  );
  tarball = resolve(packageRoot, packed[0].filename);

  writeFileSync(
    join(tempRoot, "package.json"),
    JSON.stringify({ name: "tasknotes-model-package-smoke", private: true, type: "module" }),
  );
  writeFileSync(
    join(tempRoot, "esm.mjs"),
    'import * as model from "@tasknotes/model";\nif (Object.keys(model).length === 0) throw new Error("ESM export is empty");\n',
  );
  writeFileSync(
    join(tempRoot, "cjs.cjs"),
    'const model = require("@tasknotes/model");\nif (Object.keys(model).length === 0) throw new Error("CJS export is empty");\n',
  );
  writeFileSync(
    join(tempRoot, "attachments.mjs"),
    'import { canonicalAttachmentReference } from "@tasknotes/model/attachments";\nif (canonicalAttachmentReference("Attachments/image.png") !== "[[Attachments/image.png]]") throw new Error("ESM attachment export is unavailable");\n',
  );
  writeFileSync(
    join(tempRoot, "attachments.cjs"),
    'const { canonicalAttachmentReference } = require("@tasknotes/model/attachments");\nif (canonicalAttachmentReference("Attachments/image.png") !== "[[Attachments/image.png]]") throw new Error("CJS attachment export is unavailable");\n',
  );

  runNpm(["install", "--ignore-scripts", tarball], {
    cwd: tempRoot,
    stdio: "inherit",
  });
  execFileSync(process.execPath, ["esm.mjs"], { cwd: tempRoot, stdio: "inherit" });
  execFileSync(process.execPath, ["cjs.cjs"], { cwd: tempRoot, stdio: "inherit" });
  execFileSync(process.execPath, ["attachments.mjs"], { cwd: tempRoot, stdio: "inherit" });
  execFileSync(process.execPath, ["attachments.cjs"], { cwd: tempRoot, stdio: "inherit" });
} finally {
  if (tarball) rmSync(tarball, { force: true });
  rmSync(tempRoot, { recursive: true, force: true });
}
