/**
 * Writes names/known-taxa.txt from the Open Paleo data build: every genus, every species and
 * every synonym, one name per line, sorted. The file is a snapshot committed with this
 * repository; rerun this when the data repository changes.
 *
 *   npm run names:import -- ../data/dist/open-paleo.json
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";

/**
 * The parts of the data build this script reads.
 */
type DataBuild = {
    _metadata: { version: string; built_at: string };
    genera: Record<string, GenusRecord>;
};

/**
 * One genus in the data build.
 */
type GenusRecord = {
    genus: string;
    synonyms?: Array<{ name: string }>;
    species?: Array<{ name: string; synonyms?: Array<{ name: string }> }>;
};

const scriptDirectory = path.dirname(url.fileURLToPath(import.meta.url));
const source = process.argv[2] ?? path.join(scriptDirectory, "..", "..", "data", "dist", "open-paleo.json");
const target = path.join(scriptDirectory, "..", "names", "known-taxa.txt");
const build = JSON.parse(fs.readFileSync(source, "utf8")) as DataBuild;
const names = new Set<string>();

for (const genus of Object.values(build.genera))
{
    names.add(genus.genus);

    for (const synonym of genus.synonyms ?? [])
    {
        names.add(synonym.name);
    }

    for (const species of genus.species ?? [])
    {
        names.add(species.name);

        for (const synonym of species.synonyms ?? [])
        {
            names.add(synonym.name);
        }
    }
}

const sorted = [...names].sort((left, right) => left.localeCompare(right, "en"));
fs.writeFileSync(target, `${sorted.join("\n")}\n`);
fs.writeFileSync(path.join(scriptDirectory, "..", "names", "README.md"), [
    "# Known taxon names",
    "",
    "`known-taxa.txt` lists every genus, species and synonym in the Open Paleo data build, one",
    "name per line. The extractor uses it as a second tier of name matching: a label that the",
    "paper's own name list does not explain is offered to this list at a stricter threshold, and",
    "a match from it is flagged in the quality checks as coming from outside the paper's taxa.",
    "",
    `Snapshot of open-paleo/data version ${build._metadata.version}, built ${build._metadata.built_at},`,
    `${sorted.length} names. Regenerate with \`npm run names:import -- <path to open-paleo.json>\`.`,
    "",
    "The data build is CC BY 4.0, attributed to the Open Paleo contributors.",
    "",
].join("\n"));
console.log(`${sorted.length} names written to ${path.relative(process.cwd(), target)} from data ${build._metadata.version}`);
