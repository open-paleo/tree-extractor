/**
 * Fuzzy matching of OCR output against a closed list of taxon names.
 */

import type { NameMatch } from "./types.ts";

/**
 * Lower-cases a name and reduces every run of non-alphanumerics to a single space.
 *
 * @param text - Name or OCR output.
 * @returns Normalized form.
 */
export function normalizeName(text: string): string
{
    return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Edit distance between two strings.
 *
 * @param left - First string.
 * @param right - Second string.
 * @returns Number of single-character edits.
 */
export function computeLevenshtein(left: string, right: string): number
{
    let previous = new Array<number>(right.length + 1);
    let current = new Array<number>(right.length + 1);

    for (let column = 0; column <= right.length; column++)
    {
        previous[column] = column;
    }

    for (let row = 1; row <= left.length; row++)
    {
        current[0] = row;

        for (let column = 1; column <= right.length; column++)
        {
            const substitution = previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1);
            current[column] = Math.min(previous[column] + 1, current[column - 1] + 1, substitution);
        }

        [previous, current] = [current, previous];
    }

    return previous[right.length];
}

/**
 * Similarity from 0 (nothing shared) to 1 (identical) based on edit distance.
 *
 * @param left - First string.
 * @param right - Second string.
 * @returns Similarity.
 */
export function computeSimilarity(left: string, right: string): number
{
    return 1 - computeLevenshtein(left, right) / Math.max(left.length, right.length, 1);
}

/**
 * Generic name endings shared by many taxa. Two names with the same ending are no closer than
 * their stems: "Thescelosaurus" and "Herrerasaurus" share half their letters and nothing else.
 */
const sharedEndings = ["saurus", "saura", "ceratops", "raptor", "suchus", "venator", "mimus", "titan", "pteryx", "odon"];

/**
 * Similarity of two normalized names, discounting a generic ending both of them carry.
 *
 * @param left - First name.
 * @param right - Second name.
 * @returns Similarity from 0 to 1.
 */
export function compareNames(left: string, right: string): number
{
    let score = computeSimilarity(left, right);

    for (const ending of sharedEndings)
    {
        if (left.length > ending.length + 2 && right.length > ending.length + 2 && left.endsWith(ending) && right.endsWith(ending))
        {
            score = Math.min(score, computeSimilarity(left.slice(0, -ending.length), right.slice(0, -ending.length)));
            break;
        }
    }

    return score;
}

/**
 * Words that say nothing about which name it is.
 */
const fillerTokens = new Set(["sp", "cf", "aff", "nov", "gen", "indet", "et", "al"]);

/**
 * Words of a normalized name that carry it: "sp" and its kin are left out, and so is OCR
 * rubble (a letter four times in a row, three or fewer different letters in six or more, or a
 * long word with no vowel or digit; "CPC" is a collection prefix and stays).
 *
 * @param text - Normalized text.
 * @returns Its carrying words.
 */
function listCarryingTokens(text: string): Array<string>
{
    const tokens = new Array<string>();

    for (const token of text.split(" "))
    {
        if (token.length < 2 || fillerTokens.has(token) || /(.)\1\1\1/.test(token) || (token.length > 4 && !/[aeiouy0-9]/.test(token)) || (token.length >= 6 && new Set(token).size <= 3))
        {
            continue;
        }

        tokens.push(token);
    }

    return tokens;
}

/**
 * Scores a read against a name by the words they share, whatever the order: a specimen
 * number printed before the genus ("MOR 692 Avaceratops") is the list's "Avaceratops sp.
 * MOR 692". Two shared words are needed, so a genus alone never passes as a species.
 *
 * @param target - Normalized read.
 * @param name - Normalized name.
 * @returns Share of the longer word set that is shared, or 0 with fewer than two shared words.
 */
export function compareTokenSets(target: string, name: string): number
{
    const targetTokens = listCarryingTokens(target);
    const nameTokens = new Set(listCarryingTokens(name));
    let shared = 0;

    for (const token of targetTokens)
    {
        if (nameTokens.has(token))
        {
            shared++;
        }
    }

    if (shared < 2)
    {
        return 0;
    }

    return shared / Math.max(targetTokens.length, nameTokens.size);
}

/**
 * Scores OCR text against one name, allowing the forms figures print: the full name, the genus
 * alone, the genus abbreviated to its initial ("S. homheni" for "Stegosaurus homheni"), or
 * the same words in another order.
 *
 * @param target - Normalized OCR text.
 * @param name - Normalized candidate name.
 * @returns Similarity from 0 to 1.
 */
export function scoreName(target: string, name: string): number
{
    let score = Math.max(compareNames(target, name), compareTokenSets(target, name));
    const space = name.indexOf(" ");
    const targetSpace = target.indexOf(" ");

    // A list of genera against a figure of binomials: the read's first word is the name.
    if (space < 0 && targetSpace > 0)
    {
        score = Math.max(score, compareNames(target.slice(0, targetSpace), name) - 0.05);
    }

    if (space > 0)
    {
        const genus = name.slice(0, space);
        const rest = name.slice(space + 1);
        score = Math.max(score, compareNames(target, genus) - 0.05);

        if (targetSpace > 0 && target[0] === genus[0] && targetSpace <= 2)
        {
            score = Math.max(score, compareNames(target.slice(targetSpace + 1), rest) - 0.05);
        }
    }

    return score;
}

/**
 * Matches OCR output against a list of names.
 *
 * @param text - OCR output.
 * @param names - Candidate names, in their original spelling.
 * @returns The best candidate with its scores, or null for empty input or an empty list.
 */
export function matchName(text: string, names: Array<string>): NameMatch | null
{
    const target = normalizeName(text);

    if (target.length === 0 || names.length === 0)
    {
        return null;
    }

    let bestName = names[0];
    let bestScore = -1;
    let secondScore = -1;

    for (const name of names)
    {
        const score = scoreName(target, normalizeName(name));

        if (score > bestScore)
        {
            secondScore = bestScore;
            bestScore = score;
            bestName = name;
        }
        else if (score > secondScore)
        {
            secondScore = score;
        }
    }

    const margin = secondScore < 0 ? bestScore : bestScore - secondScore;

    return {
        name: bestName,
        similarity: bestScore,
        margin,
        accepted: bestScore >= 0.75 || (bestScore >= 0.6 && margin >= 0.12),
        source: "list",
    };
}

/**
 * Matches OCR output against the known taxa of the whole data set, as a second tier after the
 * paper's own list. The list is large and full of near neighbors, so the bar is higher: the
 * read must be an exact name, or close to one and clear of the runner-up.
 *
 * @param text - Raw OCR text.
 * @param knownNames - Known taxon names.
 * @returns The best match with acceptance decided, or null when the list is empty.
 */
export function matchKnownName(text: string, knownNames: Array<string>): NameMatch | null
{
    // A binomial read is matched among binomials and a one-word read among genera, so that a
    // species never has its own genus as runner-up (every binomial scores well against its
    // genus, which would leave no margin). A binomial read that no species explains is still
    // offered to the genera, for figures that print "Genus sp." or an unlisted species.
    const genera = new Array<string>();
    const binomials = new Array<string>();

    for (const name of knownNames)
    {
        if (name.includes(" "))
        {
            binomials.push(name);
        }
        else
        {
            genera.push(name);
        }
    }

    const pools = normalizeName(text).includes(" ") ? [binomials, genera] : [genera];
    let fallback: NameMatch | null = null;

    for (const pool of pools)
    {
        const match = pool.length === 0 ? null : matchName(text, pool);

        if (match === null)
        {
            continue;
        }

        const exact = match.similarity >= 0.98;
        const close = match.similarity >= 0.85 && match.margin >= 0.1;
        const known: NameMatch = { name: match.name, similarity: match.similarity, margin: match.margin, accepted: exact || close, source: "known" };

        if (known.accepted)
        {
            return known;
        }

        fallback ??= known;
    }

    return fallback;
}
