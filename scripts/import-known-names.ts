/**
 * Writes names/known-taxa.txt from the Open Paleo data build: every genus, every species,
 * every synonym and every original combination of a species since moved to another genus,
 * one name per line, sorted. The file is a snapshot committed with this
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
    clades?: Record<string, unknown>;
};

/**
 * One genus in the data build.
 */
type GenusRecord = {
    genus: string;
    synonyms?: Array<{ name: string }>;
    species?: Array<{ name: string; erected_as?: string; synonyms?: Array<{ name: string }> }>;
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

        // The binomial as first published, when the species was named in another genus. An
        // older figure prints that combination, and the tool gives a name as it is printed.
        if (species.erected_as !== undefined)
        {
            names.add(species.erected_as);
        }

        for (const synonym of species.synonyms ?? [])
        {
            names.add(synonym.name);
        }
    }
}

const sorted = [...names].sort((left, right) => left.localeCompare(right, "en"));
fs.writeFileSync(target, `${sorted.join("\n")}\n`);

// The clades above the genera, in a list of their own: among the genera, Dryosauridae would
// stand beside Dryosaurus as a candidate for every tip.
const clades = Object.keys(build.clades ?? {}).sort((left, right) => left.localeCompare(right, "en"));
fs.writeFileSync(path.join(scriptDirectory, "..", "names", "known-clades.txt"), `${clades.join("\n")}\n`);
fs.writeFileSync(path.join(scriptDirectory, "..", "names", "README.md"), [
    "# Known taxon names",
    "",
    "`known-taxa.txt` lists every genus, species, synonym and original combination of a species",
    "since moved to another genus in the Open Paleo data build, one name per line. A figure is",
    "read as printed, so a name stays in the combination the figure uses. The extractor uses it as a second tier of name matching: a label that the",
    "paper's own name list does not explain is offered to this list at a stricter threshold, and",
    "a match from it is flagged in the quality checks as coming from outside the paper's taxa.",
    "",
    "`known-clades.txt` lists the clades above the genera. It mends the spelling of a clade's",
    "name read at a node, on a shaded box or at a tip that is a collapsed clade, and is kept",
    "apart so that a clade never competes with a genus for a tip.",
    "",
    `Snapshot of open-paleo/data version ${build._metadata.version}, built ${build._metadata.built_at},`,
    `${sorted.length} names. Regenerate with \`npm run names:import -- <path to open-paleo.json>\`.`,
    "",
    "The data build is CC BY 4.0, attributed to the Open Paleo contributors.",
    "",
].join("\n"));
console.log(`${clades.length} clades written to names/known-clades.txt`);
console.log(`${sorted.length} names written to ${path.relative(process.cwd(), target)} from data ${build._metadata.version}`);
