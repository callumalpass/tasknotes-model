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

  for (const [filename, content] of [
    ["calendar.mjs", 'import { buildCalendarEntries, createCalendarEntryIndex, planCalendarEdit } from "@tasknotes/model/calendar";\nimport { calendarFixtures } from "@tasknotes/model/calendar/fixtures";\nif (!planCalendarEdit || !createCalendarEntryIndex || buildCalendarEntries(calendarFixtures[0].input).length !== calendarFixtures[0].expectedEntries.length) throw new Error("ESM calendar exports failed");\n'],
    ["calendar.cjs", 'const { buildCalendarEntries } = require("@tasknotes/model/calendar");\nconst { calendarFixtures } = require("@tasknotes/model/calendar/fixtures");\nconst raw = [...require("@tasknotes/model/fixtures/calendar/scenarios.json"), ...require("@tasknotes/model/fixtures/calendar/moved-occurrences.json")];\nif (raw.length !== calendarFixtures.length || buildCalendarEntries(raw[0].input).length !== raw[0].expectedEntries.length) throw new Error("CJS calendar exports failed");\n'],
    ["calendar.ts", 'import { buildCalendarEntries, type CalendarEntry } from "@tasknotes/model/calendar";\nimport { calendarFixtures, type CalendarFixture } from "@tasknotes/model/calendar/fixtures";\nconst fixture: CalendarFixture = calendarFixtures[0];\nconst entries: CalendarEntry[] = buildCalendarEntries(fixture.input);\nvoid entries;\n'],
  ]) writeFileSync(join(tempRoot, filename), content);

  runNpm(["install", "--ignore-scripts", tarball], {
    cwd: tempRoot,
    stdio: "inherit",
  });
  execFileSync(process.execPath, ["esm.mjs"], { cwd: tempRoot, stdio: "inherit" });
  execFileSync(process.execPath, ["cjs.cjs"], { cwd: tempRoot, stdio: "inherit" });
  execFileSync(process.execPath, ["attachments.mjs"], { cwd: tempRoot, stdio: "inherit" });
  execFileSync(process.execPath, ["attachments.cjs"], { cwd: tempRoot, stdio: "inherit" });
  execFileSync(process.execPath, ["calendar.mjs"], { cwd: tempRoot, stdio: "inherit" });
  execFileSync(process.execPath, ["calendar.cjs"], { cwd: tempRoot, stdio: "inherit" });
  for (const resolution of ["nodenext", "node"]) {
    execFileSync(process.execPath, [resolve(packageRoot, "node_modules/typescript/bin/tsc"),
      "--noEmit", "--strict", "--target", "es2020", "--module", resolution === "nodenext" ? "nodenext" : "esnext",
      "--moduleResolution", resolution, "calendar.ts"], { cwd: tempRoot, stdio: "inherit" });
  }
} finally {
  if (tarball) rmSync(tarball, { force: true });
  rmSync(tempRoot, { recursive: true, force: true });
}
