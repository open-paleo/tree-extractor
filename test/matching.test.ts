import assert from "node:assert/strict";
import { test } from "node:test";

import { computeLevenshtein, matchName, normalizeName } from "../src/core/matching.ts";
import { cleanSupportText, cleanTaxonText } from "../src/core/labels.ts";

const names = ["Cumnoria_prestwichii", "Uteodon_aphanoecetes", "Fostoria_dhimbangunmal", "Rhabdodon_sp1", "Rhabdodon_priscus", "Dryosaurus"];

test("computeLevenshtein and normalizeName behave", () =>
{
    assert.equal(computeLevenshtein("kitten", "sitting"), 3);
    assert.equal(normalizeName("Rhabdodon sp.1"), "rhabdodon sp 1");
});

test("figure spellings match matrix spellings", () =>
{
    assert.equal(matchName("Cumnoria prestwichi", names)?.name, "Cumnoria_prestwichii");
    assert.equal(matchName("Uteodon aphanooecetes", names)?.name, "Uteodon_aphanoecetes");
    assert.equal(matchName("Fostoria dhinbangunmal", names)?.name, "Fostoria_dhimbangunmal");
    assert.equal(matchName("Rhabdodon sp.1", names)?.name, "Rhabdodon_sp1");
    assert.ok(matchName("Rhabdodon sp.1", names)?.accepted);
});

test("garbage is not accepted", () =>
{
    const match = matchName("DYSALOTOSAURINAE", names);
    assert.ok(match !== null);
    assert.equal(match.accepted, false);
    assert.equal(matchName("", names), null);
});

test("label cleaners strip decoration", () =>
{
    assert.equal(cleanTaxonText("— Dryosaurus -—"), "Dryosaurus");
    assert.equal(cleanTaxonText("Chakisaurus ‘nekul."), "Chakisaurus nekul.");
    assert.equal(cleanTaxonText("= Rhabdodon sp.1 ="), "Rhabdodon sp.1");
    assert.equal(cleanSupportText("7/804"), "7/804");
    assert.equal(cleanSupportText("—1/77"), "1/77");
    assert.equal(cleanSupportText("l8/1OO"), "18/100");
});
