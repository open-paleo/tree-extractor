/**
 * Random trees with polytomies and plausible taxon names.
 */

import type { SeededRandom } from "./random.ts";

/**
 * A node of a synthetic tree.
 */
export type SyntheticNode = {
    /**
     * Taxon name for a tip, or null for an internal node.
     */
    name: string | null;

    /**
     * Children, empty for a tip.
     */
    children: Array<SyntheticNode>;

    /**
     * Support value printed at the node, or null.
     */
    support: string | null;

    /**
     * Branch length above the node, for phylograms.
     */
    length: number;
};

// cspell:disable -- name syllables, not words
const genusStarts = ["Aga", "Bra", "Cal", "Dei", "Eo", "Fos", "Gal", "Hyp", "Igu", "Kan", "Lea", "Mut", "Nan", "Oro", "Par", "Rha", "Sau", "Tal", "Ute", "Val", "Zal"];
const genusMiddles = ["li", "cho", "ro", "no", "do", "ne", "ki", "ta", "mo", "si", "la", "ri", "pe", "ga"];
const genusEnds = ["saurus", "don", "ceratops", "raptor", "cursor", "pelta", "mimus", "suchus", "titan", "venator", "onyx", "lestes"];
const speciesParts = ["magn", "parv", "gracil", "robust", "long", "brevi", "australi", "boreal", "orient", "occident", "antiqu", "nov", "altern", "elegan", "ferox", "minor", "major", "lat", "angust", "mirabil"];
const speciesEnds = ["us", "a", "is", "ensis", "i", "ae", "oides", "orum"];
// cspell:enable

/**
 * Makes a binomial that looks like a dinosaur name.
 *
 * @param random - Random source.
 * @param used - Names already given, to keep names unique.
 * @returns A new name.
 */
export function createTaxonName(random: SeededRandom, used: Set<string>): string
{
    for (;;)
    {
        const genus = random.pick(genusStarts) + random.pick(genusMiddles) + random.pick(genusEnds);
        const species = random.pick(speciesParts) + random.pick(speciesEnds);
        const name = `${genus} ${species}`;

        if (!used.has(name))
        {
            used.add(name);

            return name;
        }
    }
}

/**
 * Makes a support label such as "1", "5/82" or "92".
 *
 * @param random - Random source.
 * @param style - Which kind of value to print.
 * @returns The label.
 */
function createSupport(random: SeededRandom, style: "bremer" | "bootstrap" | "both"): string
{
    const bremer = random.nextInt(1, 9);
    const bootstrap = random.nextInt(50, 100);

    if (style === "bremer")
    {
        return `${bremer}`;
    }

    if (style === "bootstrap")
    {
        return `${bootstrap}`;
    }

    return random.chance(0.5) ? `${bremer}` : `${bremer}/${bootstrap}`;
}

/**
 * Builds a random tree by repeatedly joining subtrees, then collapsing some nodes into
 * polytomies.
 *
 * @param random - Random source.
 * @param tipCount - Number of tips.
 * @param polytomyRate - Chance that an internal node is collapsed into its parent.
 * @param supportStyle - Kind of support values, or null for none.
 * @returns The root.
 */
export function createRandomTree(random: SeededRandom, tipCount: number, polytomyRate: number, supportStyle: "bremer" | "bootstrap" | "both" | null): SyntheticNode
{
    const used = new Set<string>();
    let pool = new Array<SyntheticNode>();

    for (let index = 0; index < tipCount; index++)
    {
        pool.push({ name: createTaxonName(random, used), children: [], support: null, length: random.nextBetween(0.5, 3) });
    }

    while (pool.length > 1)
    {
        const first = random.nextInt(0, pool.length - 1);
        let second = random.nextInt(0, pool.length - 2);

        if (second >= first)
        {
            second++;
        }

        const joined: SyntheticNode = {
            name: null,
            children: [pool[first], pool[second]],
            support: supportStyle === null ? null : createSupport(random, supportStyle),
            length: random.nextBetween(0.5, 3),
        };
        const rest = new Array<SyntheticNode>();

        for (let index = 0; index < pool.length; index++)
        {
            if (index !== first && index !== second)
            {
                rest.push(pool[index]);
            }
        }

        rest.push(joined);
        pool = rest;
    }

    const root = pool[0];
    root.support = null;
    collapsePolytomies(root, random, polytomyRate);

    return root;
}

/**
 * Collapses internal children into their parent at random, making polytomies.
 *
 * @param node - Subtree root.
 * @param random - Random source.
 * @param rate - Chance per internal child.
 */
function collapsePolytomies(node: SyntheticNode, random: SeededRandom, rate: number): void
{
    const expanded = new Array<SyntheticNode>();

    for (const child of node.children)
    {
        if (child.children.length > 0 && random.chance(rate))
        {
            expanded.push(...child.children);
        }
        else
        {
            expanded.push(child);
        }
    }

    node.children = expanded;

    for (const child of node.children)
    {
        collapsePolytomies(child, random, rate);
    }
}

/**
 * Lists tip names in tree order.
 *
 * @param node - Subtree root.
 * @param names - Receives the names.
 */
export function collectTipNames(node: SyntheticNode, names: Array<string>): void
{
    if (node.name !== null)
    {
        names.push(node.name);
    }

    for (const child of node.children)
    {
        collectTipNames(child, names);
    }
}

/**
 * Serializes the tree as Newick with support values as node labels.
 *
 * @param node - Subtree root.
 * @returns Newick text without the trailing semicolon.
 */
export function formatSyntheticNewick(node: SyntheticNode): string
{
    if (node.name !== null)
    {
        return node.name.replace(/ /g, "_");
    }

    const parts = new Array<string>();

    for (const child of node.children)
    {
        parts.push(formatSyntheticNewick(child));
    }

    const label = node.support === null ? "" : `'${node.support}'`;

    return `(${parts.join(",")})${label}`;
}
