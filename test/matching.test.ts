import assert from "node:assert/strict";
import { test } from "node:test";

import { compareNames, computeLevenshtein, matchKnownName, matchName, normalizeName } from "../src/core/matching.ts";
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

test("genus-only and abbreviated-genus forms match the full name", () =>
{
    const names = ["Dacentrurus armatus", "Stegosaurus homheni", "Stegosaurus mjosi", "Scelidosaurus"];
    assert.equal(matchName("Dacentrurus", names)?.name, "Dacentrurus armatus");
    assert.ok(matchName("Dacentrurus", names)?.accepted);
    assert.equal(matchName("S. homheni", names)?.name, "Stegosaurus homheni");
    assert.ok(matchName("S. homheni", names)?.accepted);
    assert.equal(matchName("S. mjosi", names)?.name, "Stegosaurus mjosi");
    assert.equal(matchName("Scelidosaurus", names)?.name, "Scelidosaurus");
});

test("a binomial read matches a genus-only list entry", () =>
{
    const names = ["Stegosaurus", "Haya", "Thescelosaurus", "Othnielosaurus"];
    assert.equal(matchName("Stegosaurus stenops", names)?.name, "Stegosaurus");
    assert.ok(matchName("Stegosaurus stenops", names)?.accepted);
    assert.equal(matchName("Haya griva", names)?.name, "Haya");
    assert.equal(matchName("Thescelosaurus", names)?.name, "Thescelosaurus");
});

test("names sharing a generic ending are compared by their stems", () =>
{
    assert.ok(compareNames("thescelosaurus", "herrerasaurus") < 0.5);
    assert.ok(compareNames("quranosaurus", "ouranosaurus") > 0.8);
    assert.ok(!matchName("Thescelosaurus", ["Herrerasaurus", "Sanjuansaurus", "Haya"])?.accepted);
});

test("known taxa accept exact names despite their species, and only clear near misses", () =>
{
    const known = ["Thescelosaurus", "Thescelosaurus neglectus", "Thescelosaurus assiniboiensis", "Tenontosaurus", "Zalmoxes", "Zalmoxes robustus", "Zalmoxes robustum"];
    const exact = matchKnownName("Thescelosaurus", known);
    assert.ok(exact !== null && exact.accepted);
    assert.equal(exact.name, "Thescelosaurus");
    assert.equal(exact.source, "known");
    const species = matchKnownName("Thescelosaurus neqlectus", known);
    assert.ok(species !== null && species.accepted);
    assert.equal(species.name, "Thescelosaurus neglectus");
    const nearMiss = matchKnownName("Tenontosaurs", known);
    assert.ok(nearMiss !== null && nearMiss.accepted);
    assert.equal(nearMiss.name, "Tenontosaurus");
    // Two species one letter apart leave no margin; the read falls back to the genus.
    const ambiguous = matchKnownName("Zalmoxes robustu", known);
    assert.ok(ambiguous !== null && ambiguous.accepted);
    assert.equal(ambiguous.name, "Zalmoxes");
    const unlistedSpecies = matchKnownName("Zalmoxes sp.", known);
    assert.ok(unlistedSpecies !== null && unlistedSpecies.accepted);
    assert.equal(unlistedSpecies.name, "Zalmoxes");
    assert.equal(matchKnownName("Zalmoxes", []), null);
});
