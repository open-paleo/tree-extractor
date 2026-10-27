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
        const score = computeSimilarity(target, normalizeName(name));

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
    };
}
