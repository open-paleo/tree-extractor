import assert from "node:assert/strict";
import { test } from "node:test";

import { compareNames, computeLevenshtein, matchKnownName, matchName, normalizeName } from "../src/core/matching.ts";
import { cleanSupportText, cleanTaxonText, isNameText, chooseMatch, isBoxedCladeName, matchCladeName } from "../src/core/labels.ts";

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

test("a clade name at a node is told from a support value", () =>
{
    assert.equal(isNameText("Dryomorpha"), true);
    assert.equal(isNameText("Clade A"), true);
    assert.equal(isNameText("100"), false);
    assert.equal(isNameText("0.98"), false);
    assert.equal(isNameText("87/5"), false);
    assert.equal(isNameText("lOO"), false);
});

test("a species read correctly is kept when the known taxa hold only its genus", () =>
{
    const known = ["Zalmoxes", "Zalmoxes robustus", "Tenontosaurus tilletti"];
    assert.equal(chooseMatch("Zalmoxes shqiperorum", [], known)?.name, "Zalmoxes shqiperorum");
    assert.equal(chooseMatch("Zalmoxes robustus", [], known)?.name, "Zalmoxes robustus");
    assert.equal(chooseMatch("Zalmoxes", [], known)?.name, "Zalmoxes");
    // The paper's own list is authoritative: a genus-only entry there names the tip.
    assert.equal(chooseMatch("Zalmoxes shqiperorum", ["Zalmoxes"], known)?.name, "Zalmoxes");
});

test("an indeterminate species stays on a genus the known taxa supplied", () =>
{
    const known = ["Rhabdodon", "Rhabdodon priscus"];
    assert.equal(chooseMatch("Rhabdodon sp.", [], known)?.name, "Rhabdodon sp.");
    assert.equal(chooseMatch("Rhabdodon sp. 1", [], known)?.name, "Rhabdodon sp. 1");
    assert.equal(chooseMatch("Rhabdodon sp.1", [], known)?.name, "Rhabdodon sp.1");
    assert.equal(chooseMatch("Rhabdodon sp 2", [], known)?.name, "Rhabdodon sp 2");
    assert.equal(chooseMatch("Rhabdodon priscus", [], known)?.name, "Rhabdodon priscus");
});

test("a clade's name on a colored box is told from a tip's name", () =>
{
    const known = ["Fostoria", "Gobivenator", "Corythosaurus intermedius"];
    assert.equal(isBoxedCladeName("DRYOSAURIDAE", [], known), true);
    assert.equal(isBoxedCladeName("Dysalotosaurinae", [], known), true);
    assert.equal(isBoxedCladeName("Iguanodontia", [], known), true);
    assert.equal(isBoxedCladeName("Ornithopoda", [], known), true);
    assert.equal(isBoxedCladeName("Fostoria", [], known), false);
    assert.equal(isBoxedCladeName("Gobivenator", [], known), false);
    assert.equal(isBoxedCladeName("Corythosaurus intermedius (C)", [], known), false);
    assert.equal(isBoxedCladeName("LATE CRETACEOUS", [], known), false);
});

test("a capital O read as Q, or I as l, still finds its name among the known taxa", () =>
{
    const known = ["Ouranosaurus", "Iguanodon", "Qantassaurus", "Lurdusaurus", "Uteodon"];
    assert.equal(chooseMatch("Quranosaurus", [], known)?.name, "Ouranosaurus");
    assert.equal(chooseMatch("Quranosaurus", [], known)?.accepted, true);
    assert.equal(chooseMatch("lguanodon", [], known)?.name, "Iguanodon");
    assert.equal(chooseMatch("Qantassaurus", [], known)?.name, "Qantassaurus");
    assert.equal(chooseMatch("Lurdusaurus", [], known)?.name, "Lurdusaurus");
});

test("qualifiers of open nomenclature stay on a name from the known taxa", () =>
{
    const known = ["Rhabdodon", "Rhabdodon priscus", "Iguanodon", "Iguanodon bernissartensis"];
    assert.equal(chooseMatch("Rhabdodon indet.", [], known)?.name, "Rhabdodon indet.");
    assert.equal(chooseMatch("Rhabdodon sp. indet.", [], known)?.name, "Rhabdodon sp. indet.");
    assert.equal(chooseMatch("Rhabdodon cf. priscus", [], known)?.name, "Rhabdodon cf. priscus");
    assert.equal(chooseMatch("Iguanodon aff. bernissartensis", [], known)?.name, "Iguanodon aff. bernissartensis");
    assert.equal(chooseMatch("cf. Iguanodon bernissartensis", [], known)?.name, "cf. Iguanodon bernissartensis");
    assert.equal(chooseMatch("Iguanodon bernissartensis", [], known)?.name, "Iguanodon bernissartensis");
});

test("a clade's name is mended from the known clades and keeps its capitals", () =>
{
    const clades = ["Diplodocoidea", "Diplodocidae", "Dryosauridae", "Hadrosauridae", "Hadrosauroidea"];
    assert.equal(matchCladeName("Ciplodocoidea", clades)?.name, "Diplodocoidea");
    assert.equal(matchCladeName("DRYOSAURIDAF", clades)?.name, "DRYOSAURIDAE");
    assert.equal(matchCladeName("Hadrosauridae", clades)?.name, "Hadrosauridae");
    assert.equal(matchCladeName("Rhabdodontidae 87", clades), null);
    assert.equal(matchCladeName("Stegosauria", clades), null);
    assert.equal(matchCladeName("Dryosauridae", []), null);
    // A tip that is a collapsed clade is mended too, and a genus is never taken for a clade.
    assert.equal(chooseMatch("HADROSAURIDAF", [], ["Hadrosaurus"], clades)?.name, "HADROSAURIDAE");
    assert.equal(chooseMatch("Dryosaurus", [], ["Dryosaurus"], clades)?.name, "Dryosaurus");
});
