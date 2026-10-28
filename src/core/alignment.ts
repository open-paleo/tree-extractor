/**
 * What tip alignment buys: when a figure ends its tips on one vertical line, a tip elsewhere is
 * suspect and a label row at that line with no tip is a branch the trace missed. The first is
 * reported; the second is looked for in the line ink and, when a branch piece is there, added.
 */

import type { ExtractionDocument, Mask, QcIssue, TextLine } from "./types.ts";
import { addTip, findTipById } from "./edit.ts";
import { isLabelSized } from "./labels.ts";
import { collectConnected } from "./tree.ts";

/**
 * A horizontal piece of ink found in a row.
 */
type InkPiece = {
    /**
     * Left end.
     */
    x0: number;

    /**
     * Right end (exclusive).
     */
    x1: number;
};

/**
 * Label rows at the tip line that no tip owns.
 *
 * @param document - Document after label assignment, with its profile measured.
 * @param tipX - The shared tip x.
 * @returns The rows, top to bottom.
 */
function findRowsWithoutTip(document: ExtractionDocument, tipX: number): Array<TextLine>
{
    const glyph = document.glyphHeight;
    const rows = new Array<TextLine>();

    for (const line of document.textLines)
    {
        const offset = line.box.x0 - tipX;

        // A row in a level frame is not at the tip line in figure coordinates.
        if (line.frame !== undefined || line.role !== "unassigned" || !isLabelSized(line, glyph) || offset < -1.5 * glyph || offset > 5 * glyph)
        {
            continue;
        }

        const center = (line.box.y0 + line.box.y1) / 2;
        let owned = false;

        for (const tip of document.tips)
        {
            if (Math.abs(tip.y - center) <= 0.8 * glyph)
            {
                owned = true;
                break;
            }
        }

        if (!owned)
        {
            rows.push(line);
        }
    }

    rows.sort(compareRowTops);

    return rows;
}

/**
 * Orders rows by their top edge.
 *
 * @param left - First row.
 * @param right - Second row.
 * @returns Negative when left is higher.
 */
function compareRowTops(left: TextLine, right: TextLine): number
{
    return left.box.y0 - right.box.y0;
}

/**
 * Finds the piece of ink in a band of rows whose right end is nearest to, and no further than
 * a reach past, a given x. Gaps of up to two pixels inside the piece are tolerated.
 *
 * @param lineInk - Line ink mask.
 * @param y - Center row.
 * @param halfHeight - Rows to include above and below.
 * @param x - Where the piece should end.
 * @param reach - How far right of x the end may lie.
 * @returns The piece, or null when there is no ink there.
 */
function findInkPieceEndingNear(lineInk: Mask, y: number, halfHeight: number, x: number, reach: number): InkPiece | null
{
    const { width, height, data } = lineInk;
    const top = Math.max(0, y - halfHeight);
    const bottom = Math.min(height - 1, y + halfHeight);

    function isInked(column: number): boolean
    {
        for (let row = top; row <= bottom; row++)
        {
            if (data[row * width + column] === 1)
            {
                return true;
            }
        }

        return false;
    }

    let end = -1;

    for (let column = Math.min(width - 1, Math.round(x + reach)); column >= 0 && column >= x - reach; column--)
    {
        if (isInked(column))
        {
            end = column;
            break;
        }
    }

    if (end < 0)
    {
        return null;
    }

    let start = end;
    let gap = 0;

    for (let column = end - 1; column >= 0; column--)
    {
        if (isInked(column))
        {
            start = column;
            gap = 0;
        }
        else if (++gap > 2)
        {
            break;
        }
    }

    return { x0: start, x1: end + 1 };
}

/**
 * Adds tips for label rows at the tip line that have a branch piece in the line ink but no
 * tip. Runs before labels are read, so the new tips get their labels read like any other.
 *
 * @param document - Document updated in place.
 * @param lineInk - Line ink mask.
 * @param thickness - Line thickness in pixels.
 * @param minLength - Shortest piece of ink that counts as a branch.
 * @returns One informational issue per recovered tip.
 */
export function recoverAlignedTips(document: ExtractionDocument, lineInk: Mask, thickness: number, minLength: number): Array<QcIssue>
{
    const alignment = document.profile.tipAlignment;
    const issues = new Array<QcIssue>();

    if (!alignment.aligned || alignment.x === null)
    {
        return issues;
    }

    const glyph = document.glyphHeight;

    for (const row of findRowsWithoutTip(document, alignment.x))
    {
        const y = Math.round((row.box.y0 + row.box.y1) / 2);
        const piece = findInkPieceEndingNear(lineInk, y, Math.max(1, Math.round(thickness)), alignment.x, glyph);

        if (piece === null || piece.x1 - piece.x0 < minLength)
        {
            continue;
        }

        const result = addTip(document, piece.x1, y);
        const tip = result.id === null ? null : findTipById(document, result.id);

        if (tip === null)
        {
            continue;
        }

        tip.source = "traced";

        if (tip.textLine === null)
        {
            tip.textLine = row.id;
            row.role = "tip";
        }

        issues.push({
            severity: "info",
            code: "tip-recovered",
            message: `tip ${tip.id} added at the tip line for a label row the trace had no branch for (${piece.x1 - piece.x0} px of ink found)`,
            subject: tip.id,
        });
    }

    return issues;
}

/**
 * Reports what disagrees with the tip line: tips of the tree that end well away from it, and
 * label rows at it that no tip owns.
 *
 * @param document - Document with its profile measured.
 * @returns Warnings, possibly none.
 */
export function checkTipAlignment(document: ExtractionDocument): Array<QcIssue>
{
    const alignment = document.profile.tipAlignment;
    const issues = new Array<QcIssue>();

    if (!alignment.aligned || alignment.x === null)
    {
        return issues;
    }

    const glyph = document.glyphHeight;
    const connected = collectConnected(document);

    for (const tip of document.tips)
    {
        if (connected.has(tip.id) && Math.abs(tip.x - alignment.x) > glyph)
        {
            issues.push({
                severity: "warning",
                code: "tip-off-line",
                message: `tip ${tip.id} ends ${Math.round(tip.x - alignment.x)} px from the line the other tips end on`,
                subject: tip.id,
            });
        }
    }

    for (const row of findRowsWithoutTip(document, alignment.x))
    {
        issues.push({
            severity: "warning",
            code: "row-without-tip",
            message: `text row ${row.id} sits at the tip line but no tip ends there; a branch may be missing`,
            subject: row.id,
        });
    }

    return issues;
}
