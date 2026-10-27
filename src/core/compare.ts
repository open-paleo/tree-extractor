/**
 * Topology comparison between two trees, for tests and the benchmark.
 */

import type { ParsedNode } from "./newick.ts";

/**
 * Outcome of comparing a reference tree with a test tree.
 */
export type TreeComparison = {
    /**
     * Leaf labels in both trees.
     */
    sharedLeaves: Array<string>;

    /**
     * Leaf labels only in the reference tree.
     */
    missingLeaves: Array<string>;

    /**
     * Leaf labels only in the test tree.
     */
    extraLeaves: Array<string>;

    /**
     * Non-trivial splits of the reference tree, restricted to shared leaves.
     */
    referenceSplits: number;

    /**
     * Non-trivial splits of the test tree, restricted to shared leaves.
     */
    testSplits: number;

    /**
     * Splits present in both.
     */
    matchedSplits: number;

    /**
     * Reference splits not found in the test tree.
     */
    missingSplits: Array<Array<string>>;

    /**
     * Test splits not found in the reference tree.
     */
    extraSplits: Array<Array<string>>;

    /**
     * True when leaf sets and split sets both agree exactly.
     */
    identical: boolean;
};

/**
 * Collects leaf labels in tree order.
 *
 * @param node - Root of the tree.
 * @returns Leaf labels.
 */
export function collectLeafLabels(node: ParsedNode): Array<string>
{
    const labels = new Array<string>();

    function visit(current: ParsedNode): void
    {
        if (current.children.length === 0)
        {
            labels.push(current.label ?? "");
        }

        for (const child of current.children)
        {
            visit(child);
        }
    }

    visit(node);

    return labels;
}

/**
 * Collects the non-trivial splits of a tree as sorted leaf lists, keyed by a joined string.
 *
 * @param root - Root of the tree.
 * @param keep - Leaves to consider; others are pruned.
 * @returns Splits by key.
 */
function collectSplits(root: ParsedNode, keep: Set<string>): Map<string, Array<string>>
{
    const result = new Map<string, Array<string>>();
    const kept = [...keep].sort();
    const pivot = kept[0];

    function visit(node: ParsedNode): Array<string>
    {
        if (node.children.length === 0)
        {
            const label = node.label ?? "";

            return keep.has(label) ? [label] : [];
        }

        const leaves = new Array<string>();

        for (const child of node.children)
        {
            leaves.push(...visit(child));
        }

        if (node !== root && leaves.length >= 2 && leaves.length <= keep.size - 2)
        {
            // A bipartition is the same whichever side is listed; list the smaller side, and on a tie
            // the side without the pivot leaf, so both trees key the same split identically.
            const present = new Set(leaves);
            const complement = new Array<string>();

            for (const leaf of kept)
            {
                if (!present.has(leaf))
                {
                    complement.push(leaf);
                }
            }

            const side = leaves.length < complement.length || (leaves.length === complement.length && !present.has(pivot))
                ? [...leaves].sort()
                : complement;
            result.set(side.join("\u0000"), side);
        }

        return leaves;
    }

    visit(root);

    return result;
}

/**
 * Compares a test tree against a reference tree by leaf sets and bipartitions.
 *
 * @param reference - Trusted tree.
 * @param test - Tree to evaluate.
 * @returns Leaf and split agreement.
 */
export function compareTrees(reference: ParsedNode, test: ParsedNode): TreeComparison
{
    const referenceLeaves = new Set(collectLeafLabels(reference));
    const testLeaves = new Set(collectLeafLabels(test));
    const shared = new Set<string>();
    const missingLeaves = new Array<string>();
    const extraLeaves = new Array<string>();

    for (const leaf of referenceLeaves)
    {
        if (testLeaves.has(leaf))
        {
            shared.add(leaf);
        }
        else
        {
            missingLeaves.push(leaf);
        }
    }

    for (const leaf of testLeaves)
    {
        if (!referenceLeaves.has(leaf))
        {
            extraLeaves.push(leaf);
        }
    }

    const referenceSplits = collectSplits(reference, shared);
    const testSplits = collectSplits(test, shared);
    const missingSplits = new Array<Array<string>>();
    const extraSplits = new Array<Array<string>>();

    for (const [key, leaves] of referenceSplits)
    {
        if (!testSplits.has(key))
        {
            missingSplits.push(leaves);
        }
    }

    for (const [key, leaves] of testSplits)
    {
        if (!referenceSplits.has(key))
        {
            extraSplits.push(leaves);
        }
    }

    return {
        sharedLeaves: [...shared],
        missingLeaves,
        extraLeaves,
        referenceSplits: referenceSplits.size,
        testSplits: testSplits.size,
        matchedSplits: referenceSplits.size - missingSplits.length,
        missingSplits,
        extraSplits,
        identical: referenceLeaves.size === testLeaves.size
            && shared.size === referenceLeaves.size
            && missingSplits.length === 0
            && extraSplits.length === 0,
    };
}
