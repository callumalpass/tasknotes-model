import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const contractsRoot =
	process.env.MDBASE_CONTRACTS_ROOT ??
	path.resolve(import.meta.dirname, "../../mdbase-contracts");
const generatedPath = path.resolve(
	import.meta.dirname,
	"../src/generated/tasknotes-type-pack.json"
);
const source = await readFile(
	path.join(contractsRoot, "dist/packs/tasknotes.task/0.3.0-rc.23.json"),
	"utf8"
);

await mkdir(path.dirname(generatedPath), { recursive: true });
await writeFile(generatedPath, source);
console.log(`Synced TaskNotes type pack from ${contractsRoot}`);
