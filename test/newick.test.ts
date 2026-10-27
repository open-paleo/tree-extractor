import assert from "node:assert/strict";
import { test } from "node:test";

import { extractFirstTreeFromNexus, formatLabel, parseNewick } from "../src/core/newick.ts";
import { compareTrees, collectLeafLabels } from "../src/core/compare.ts";

test("parseNewick handles polytomies, quoted labels, internal labels and lengths", () =>
{
    const tree = parseNewick("((A_b:1.5,'C ''quoted''',D)'5/82',(E,F)1)root;");
    assert.equal(tree.label, "root");
    assert.equal(tree.children.length, 2);
    assert.equal(tree.children[0].label, "5/82");
    assert.deepEqual(collectLeafLabels(tree), ["A b", "C 'quoted'", "D", "E", "F"]);
    assert.equal(tree.children[0].children[0].length, 1.5);
});

test("formatLabel prefers underscores and quotes only when needed", () =>
{
    assert.equal(formatLabel("Haya griva"), "Haya_griva");
    assert.equal(formatLabel("Rhabdodon sp.1"), "Rhabdodon_sp.1");
    assert.equal(formatLabel("5/82"), "'5/82'");
    assert.equal(formatLabel("it's"), "'it''s'");
});

test("extractFirstTreeFromNexus finds the TREE statement and drops comments", () =>
{
    const nexus = "#NEXUS\n[ comment ]\nBEGIN TREES;\n    TREE t = [&R] ((A,B),C);\nEND;\n";
    assert.equal(extractFirstTreeFromNexus(nexus), "((A,B),C);");
});

test("compareTrees ignores rotation and reports moved leaves as missing splits", () =>
{
    const reference = parseNewick("(((A,B),C),(D,(E,F)));");
    assert.ok(compareTrees(reference, parseNewick("((D,(F,E)),(C,(B,A)));")).identical);

    const moved = compareTrees(reference, parseNewick("(((A,C),B),(D,(E,F)));"));
    assert.equal(moved.identical, false);
    assert.equal(moved.matchedSplits, 2);
    assert.deepEqual(moved.missingSplits, [["A", "B"]]);
    assert.deepEqual(moved.extraSplits, [["A", "C"]]);
});

test("compareTrees restricts splits to shared leaves", () =>
{
    const reference = parseNewick("(((A,B),C),(D,E));");
    const comparison = compareTrees(reference, parseNewick("(((A,B),C),(D,X));"));
    assert.deepEqual(comparison.missingLeaves, ["E"]);
    assert.deepEqual(comparison.extraLeaves, ["X"]);
    assert.equal(comparison.matchedSplits, comparison.referenceSplits);
});
