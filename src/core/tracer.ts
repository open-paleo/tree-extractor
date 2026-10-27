/**
 * Builds a tree from horizontal and vertical segments of a rectangular phylogeny drawn with the
 * root on the left and tips on the right. Every vertical is a candidate node and every
 * horizontal leaving it to the right is a child, so polytomies need no special handling.
 */

import type { Box, BranchRecord, QcIssue, RejectedVertical, Segment, Tip, TreeNode } from "./types.ts";
import { compareNumbers } from "./raster.ts";

/**
 * A vertical segment while it is being considered as a node.
 */
type Candidate = {
    /**
     * Segment identifier.
     */
    id: string;

    /**
     * Center x.
     */
    x: number;

    /**
     * Top.
     */
    y0: number;

    /**
     * Bottom.
     */
    y1: number;

    /**
     * Branches whose left end attaches here.
     */
    children: Array<Branch>;

    /**
     * Branches whose right end attaches here.
     */
    parents: Array<Branch>;
};

/**
 * A piece of a horizontal segment between crossings.
 */
type Branch = {
    /**
     * Piece identifier.
     */
    id: string;

    /**
     * Segment the piece came from.
     */
    segment: string;

    /**
     * Left end x.
     */
    x0: number;

    /**
     * Right end x.
     */
    x1: number;

    /**
     * Height.
     */
    y: number;

    /**
     * Vertical at the left end, or null.
     */
    left: Candidate | null;

    /**
     * Vertical at the right end, or null.
     */
    right: Candidate | null;

    /**
     * Whether the left end touches its vertical rather than merely coming close.
     */
    leftStrict: boolean;

    /**
     * Whether the right end touches its vertical rather than merely coming close.
     */
    rightStrict: boolean;

    /**
     * Whether this is a zero-length branch made for a label glued to a vertical; its right end
     * never attaches, since it ends where it starts.
     */
    glued: boolean;
};

/**
 * Output of tracing.
 */
export type TraceResult = {
    /**
     * Internal nodes, including any in disconnected subtrees.
     */
    nodes: Array<TreeNode>;

    /**
     * Terminals.
     */
    tips: Array<Tip>;

    /**
     * Root of the largest connected tree, or null.
     */
    root: string | null;

    /**
     * Findings about the trace.
     */
    issues: Array<QcIssue>;

    /**
     * Identifiers of the segments that became nodes or branches.
     */
    usedSegments: Set<string>;

    /**
     * Verticals rejected during pruning, with the reason.
     */
    rejected: Array<RejectedVertical>;

    /**
     * Every branch piece with what it attached to, for diagnostics and review.
     */
    branches: Array<BranchRecord>;
};

/**
 * Orders branches by height.
 *
 * @param left - First branch.
 * @param right - Second branch.
 * @returns Negative when the first is higher.
 */
function compareBranchHeights(left: Branch, right: Branch): number
{
    return left.y - right.y;
}

/**
 * Orders branches by left end.
 *
 * @param left - First branch.
 * @param right - Second branch.
 * @returns Negative when the first starts further left.
 */
function compareBranchLeftEnds(left: Branch, right: Branch): number
{
    return left.x0 - right.x0;
}

/**
 * Orders candidates by x, then by top.
 *
 * @param left - First candidate.
 * @param right - Second candidate.
 * @returns Negative when the first comes first.
 */
function compareCandidatePositions(left: Candidate, right: Candidate): number
{
    return left.x - right.x || left.y0 - right.y0;
}

/**
 * Orders nodes by x, rightmost first.
 *
 * @param left - First node.
 * @param right - Second node.
 * @returns Negative when the first is further right.
 */
function compareNodesRightToLeft(left: TreeNode, right: TreeNode): number
{
    return right.x - left.x;
}

/**
 * Makes a branch piece.
 *
 * @param id - Piece identifier.
 * @param segment - Source segment identifier.
 * @param x0 - Left end.
 * @param x1 - Right end.
 * @param y - Height.
 * @param glued - Whether this is a zero-length branch for a glued label.
 * @returns The piece, unattached.
 */
function createBranch(id: string, segment: string, x0: number, x1: number, y: number, glued = false): Branch
{
    return { id, segment, x0, x1, y, left: null, right: null, leftStrict: false, rightStrict: false, glued };
}

/**
 * Finds the vertical nearest to a point.
 *
 * @param candidates - Verticals still in play.
 * @param x - Point x.
 * @param y - Point y.
 * @param reach - Largest allowed horizontal distance in pixels.
 * @param slack - How far beyond a vertical's ends the point may still lie.
 * @param side - Which end of the branch this is; the vertical must lie beyond that end.
 * @returns The nearest vertical or null.
 */
function findNearestVertical(
    candidates: Iterable<Candidate>,
    x: number,
    y: number,
    reach: number,
    slack: number,
    side: "left" | "right",
): Candidate | null
{
    let best: Candidate | null = null;
    let bestDistance = Infinity;

    for (const candidate of candidates)
    {
        const distance = Math.abs(candidate.x - x);
        const onSide = side === "left" ? candidate.x <= x + slack : candidate.x >= x - slack;

        if (onSide && distance <= reach && y >= candidate.y0 - slack && y <= candidate.y1 + slack && distance < bestDistance)
        {
            best = candidate;
            bestDistance = distance;
        }
    }

    return best;
}

/**
 * Splits each horizontal at every vertical that crosses its interior. A horizontal that runs
 * straight through a node is the parent branch on the left and a child branch on the right.
 *
 * @param horizontals - Horizontal segments.
 * @param candidates - All verticals.
 * @param tolerance - Attachment tolerance in pixels.
 * @returns Branch pieces.
 */
function splitAtCrossings(horizontals: Array<Segment>, candidates: Array<Candidate>, tolerance: number): Array<Branch>
{
    const branches = new Array<Branch>();

    for (const horizontal of horizontals)
    {
        const { x0, x1 } = horizontal.box;
        const y = (horizontal.box.y0 + horizontal.box.y1) / 2;
        const crossings = new Array<number>();

        for (const candidate of candidates)
        {
            if (candidate.x > x0 + tolerance && candidate.x < x1 - tolerance && y >= candidate.y0 - tolerance && y <= candidate.y1 + tolerance)
            {
                crossings.push(candidate.x);
            }
        }

        if (crossings.length === 0)
        {
            branches.push(createBranch(horizontal.id, horizontal.id, x0, x1, y));
            continue;
        }

        crossings.sort(compareNumbers);
        let start = x0;

        for (let part = 0; part < crossings.length; part++)
        {
            branches.push(createBranch(`${horizontal.id}.${part}`, horizontal.id, start, crossings[part], y));
            start = crossings[part];
        }

        branches.push(createBranch(`${horizontal.id}.${crossings.length}`, horizontal.id, start, x1, y));
    }

    return branches;
}

/**
 * Adds a zero-length branch for every label row that sits right against a vertical within its
 * span with no branch between them: a phylogram draws a taxon as old as its node that way.
 *
 * @param branches - Branch pieces, extended in place.
 * @param candidates - All verticals.
 * @param labelRows - Boxes of tip-label-sized text rows.
 * @param tolerance - Attachment tolerance in pixels.
 * @param reach - Largest gap between a vertical and a label that still counts as glued.
 */
function addGluedBranches(branches: Array<Branch>, candidates: Array<Candidate>, labelRows: Array<Box>, tolerance: number, reach: number): void
{
    for (const row of labelRows)
    {
        const center = (row.y0 + row.y1) / 2;
        let vertical: Candidate | null = null;

        for (const candidate of candidates)
        {
            const gap = row.x0 - candidate.x;

            if (gap >= -tolerance && gap <= reach && center >= candidate.y0 - tolerance && center <= candidate.y1 + tolerance && (vertical === null || candidate.x > vertical.x))
            {
                vertical = candidate;
            }
        }

        if (vertical === null)
        {
            continue;
        }

        // A support label sits between two verticals; a tip label has nothing standing right
        // after it. A vertical just past the row's end means this is not a tip label.
        let followed = false;

        for (const candidate of candidates)
        {
            const gap = candidate.x - row.x1;

            if (gap >= -tolerance && gap <= reach && center >= candidate.y0 - tolerance && center <= candidate.y1 + tolerance)
            {
                followed = true;
                break;
            }
        }

        if (followed)
        {
            continue;
        }

        // The label already belongs to a branch when one starts at the vertical on that row, or
        // ends just left of it: then the "vertical" is a letter stem standing where the branch
        // ends, not a node.
        let hasBranch = false;

        for (const branch of branches)
        {
            if (Math.abs(branch.y - center) > tolerance)
            {
                continue;
            }

            const startsHere = branch.x0 >= vertical.x - tolerance && branch.x0 <= vertical.x + reach;
            const endsHere = branch.x1 >= vertical.x - 2 * reach && branch.x1 <= vertical.x + tolerance;

            if (startsHere || endsHere)
            {
                hasBranch = true;
                break;
            }
        }

        if (!hasBranch)
        {
            branches.push(createBranch(`glued.${branches.length}`, `glued.${branches.length}`, vertical.x, vertical.x + 2, center, true));
        }
    }
}

/**
 * Keeps only the nearest child at any one height. A second piece further right on the same row
 * is a remnant of the label beyond the branch end.
 *
 * @param candidate - Vertical whose children are pruned.
 * @param tolerance - Height difference below which two pieces share a row.
 */
function detachDuplicateChildren(candidate: Candidate, tolerance: number): void
{
    candidate.children.sort(compareBranchLeftEnds);
    const kept = new Array<Branch>();

    for (const branch of candidate.children)
    {
        let duplicate = false;

        for (const other of kept)
        {
            if (Math.abs(other.y - branch.y) <= tolerance)
            {
                duplicate = true;
                break;
            }
        }

        if (!duplicate)
        {
            kept.push(branch);
            continue;
        }

        branch.left = null;

        if (branch.right !== null)
        {
            const index = branch.right.parents.indexOf(branch);

            if (index >= 0)
            {
                branch.right.parents.splice(index, 1);
            }

            branch.right = null;
        }
    }

    candidate.children = kept;
}

/**
 * Attaches branch ends to verticals, then discards verticals with no children (a letter stem, a
 * tick mark, the right edge of a box) and repeats until stable, since each removal frees the
 * branch ends that had reached it.
 *
 * @param branches - Branch pieces.
 * @param candidates - All verticals.
 * @param tolerance - Attachment tolerance in pixels.
 * @param looseTolerance - Fallback attachment distance when nothing is within tolerance.
 * @param rejected - List that receives every rejected vertical.
 * @returns The verticals that survived.
 */
function attachAndPrune(
    branches: Array<Branch>,
    candidates: Array<Candidate>,
    tolerance: number,
    looseTolerance: number,
    rejected: Array<RejectedVertical>,
): Set<Candidate>
{
    const active = new Set(candidates);

    for (let iteration = 0; ; iteration++)
    {
        for (const candidate of active)
        {
            candidate.children = [];
            candidate.parents = [];
        }

        for (const branch of branches)
        {
            // A label's white background box can leave a gap between a branch end and its
            // vertical, so a second, looser search follows the strict one.
            branch.left = findNearestVertical(active, branch.x0, branch.y, tolerance, tolerance, "left");
            branch.leftStrict = branch.left !== null;
            branch.left ??= findNearestVertical(active, branch.x0, branch.y, looseTolerance, tolerance, "left");
            branch.right = branch.glued ? null : findNearestVertical(active, branch.x1, branch.y, tolerance, tolerance, "right");
            branch.rightStrict = branch.right !== null;

            if (!branch.glued)
            {
                branch.right ??= findNearestVertical(active, branch.x1, branch.y, looseTolerance, tolerance, "right");
            }

            // A piece whose both ends touch the same vertical is a crossing remnant, not a branch.
            if (branch.left !== null && branch.left === branch.right)
            {
                branch.left = null;
                branch.right = null;
            }

            if (branch.left !== null)
            {
                branch.left.children.push(branch);
            }

            if (branch.right !== null)
            {
                branch.right.parents.push(branch);
            }
        }

        for (const candidate of active)
        {
            detachDuplicateChildren(candidate, tolerance);
        }

        const removed = new Array<Candidate>();

        for (const candidate of active)
        {
            if (candidate.children.length === 0)
            {
                removed.push(candidate);
            }
        }

        if (removed.length === 0)
        {
            return active;
        }

        for (const candidate of removed)
        {
            active.delete(candidate);
            const children = new Array<string>();
            const parents = new Array<string>();

            for (const branch of candidate.children)
            {
                children.push(branch.id);
            }

            for (const branch of candidate.parents)
            {
                parents.push(branch.id);
            }

            rejected.push({ id: candidate.id, reason: "no-children", iteration, children, parents });
        }
    }
}

/**
 * Ranks an incoming branch as a candidate parent. One that comes from a vertical outranks a
 * loose fragment; touching ends outrank loose ones, the left end first; one arriving at a height
 * where the vertical has no child outranks one at a child's height, which is usually that
 * child's branch running on past the vertical; and among equals the longest is the branch rather
 * than label debris.
 *
 * @param branch - Incoming branch.
 * @param candidate - Vertical it arrives at.
 * @param tolerance - Height difference below which two heights are the same.
 * @returns A score; higher is better.
 */
function scoreParent(branch: Branch, candidate: Candidate, tolerance: number): number
{
    return (branch.left === null ? 0 : 1000000)
        + (branch.leftStrict ? 100000 : 0)
        + (branch.rightStrict ? 10000 : 0)
        + (isAtChildHeight(branch, candidate, tolerance) ? 0 : 1000)
        + Math.min(999, branch.x1 - branch.x0);
}

/**
 * Tells whether a branch arrives at a vertical at the height of one of the vertical's children.
 *
 * @param branch - Incoming branch.
 * @param candidate - Vertical it arrives at.
 * @param tolerance - Height difference below which two heights are the same.
 * @returns True when a child hangs at that height.
 */
function isAtChildHeight(branch: Branch, candidate: Candidate, tolerance: number): boolean
{
    for (const child of candidate.children)
    {
        if (Math.abs(child.y - branch.y) <= tolerance)
        {
            return true;
        }
    }

    return false;
}

/**
 * Chooses the incoming branch that is the vertical's parent.
 *
 * @param candidate - Vertical to inspect.
 * @param tolerance - Attachment tolerance in pixels.
 * @returns The parent branch, or null at a root.
 */
function choosePrimaryParent(candidate: Candidate, tolerance: number): Branch | null
{
    let best: Branch | null = null;

    for (const branch of candidate.parents)
    {
        if (best === null || scoreParent(branch, candidate, tolerance) > scoreParent(best, candidate, tolerance))
        {
            best = branch;
        }
    }

    return best;
}

/**
 * Finds the height of the junction under a label: the text row nearest to the left of a
 * vertical whose center lies within the given span. The support label that hid the branch sits
 * exactly on the junction, so its height is the best estimate of where the branch arrived.
 *
 * @param labelBoxes - Boxes of text rows.
 * @param x - Position of the vertical.
 * @param top - Top of the span to search.
 * @param bottom - Bottom of the span to search.
 * @param reach - How far left of the vertical a label may sit.
 * @returns The label's center height, or null when no label is there.
 */
function findJunctionLabelHeight(labelBoxes: Array<Box>, x: number, top: number, bottom: number, reach: number): number | null
{
    let best: Box | null = null;

    for (const box of labelBoxes)
    {
        const center = (box.y0 + box.y1) / 2;

        if (box.x1 >= x - reach && box.x0 <= x && center >= top && center <= bottom && (best === null || box.x1 > best.x1))
        {
            best = box;
        }
    }

    return best === null ? null : (best.y0 + best.y1) / 2;
}

/**
 * Attaches parentless nodes to the nearest node on their left whose vertical span overlaps
 * theirs. In a planar rectangular drawing the only vertical that can sit left of a node within
 * its span is its parent, so when the connecting branch has been obliterated by a label's
 * background box the parent can still be recovered. The junction height is taken from that
 * label when one is found, else from the middle of the overlap.
 *
 * @param nodes - Node lookup, modified in place.
 * @param tips - Tip lookup, used to order children.
 * @param reach - Largest horizontal distance to bridge.
 * @param tolerance - Attachment tolerance in pixels.
 * @param labelBoxes - Boxes of text rows, for locating the junction.
 * @param labelReach - How far left of a vertical its support label may sit.
 * @param issues - Findings list to append to.
 */
function bridgeOrphans(
    nodes: Map<string, TreeNode>,
    tips: Map<string, Tip>,
    reach: number,
    tolerance: number,
    labelBoxes: Array<Box>,
    labelReach: number,
    issues: Array<QcIssue>,
): void
{
    function getChildHeight(id: string): number
    {
        const node = nodes.get(id);

        if (node !== undefined)
        {
            return node.attachY ?? (node.y0 + node.y1) / 2;
        }

        return tips.get(id)?.y ?? 0;
    }

    function compareChildHeights(left: string, right: string): number
    {
        return getChildHeight(left) - getChildHeight(right);
    }

    const ordered = [...nodes.values()].sort(compareNodesRightToLeft);

    for (const node of ordered)
    {
        if (node.parent !== null)
        {
            continue;
        }

        let parent: TreeNode | null = null;

        for (const candidate of nodes.values())
        {
            const distance = node.x - candidate.x;
            const overlap = Math.min(candidate.y1, node.y1) - Math.max(candidate.y0, node.y0);

            if (distance > tolerance && distance <= reach && overlap > -tolerance && (parent === null || candidate.x > parent.x))
            {
                parent = candidate;
            }
        }

        if (parent === null)
        {
            continue;
        }

        const top = Math.max(parent.y0, node.y0) - tolerance;
        const bottom = Math.min(parent.y1, node.y1) + tolerance;
        node.parent = parent.id;
        node.attachY = findJunctionLabelHeight(labelBoxes, node.x, top, bottom, labelReach) ?? (top + bottom) / 2;
        parent.children.push(node.id);
        parent.children.sort(compareChildHeights);
        issues.push({
            severity: "info",
            code: "bridged-parent",
            message: `node ${node.id} joined to ${parent.id} across a gap of ${Math.round(node.x - parent.x)} px with no visible branch`,
            subject: node.id,
        });
    }
}

/**
 * Counts the tips below a node.
 *
 * @param id - Node or tip identifier.
 * @param nodes - Node lookup.
 * @returns Number of descendant tips.
 */
function countTips(id: string, nodes: Map<string, TreeNode>): number
{
    const node = nodes.get(id);

    if (node === undefined)
    {
        return 1;
    }

    let total = 0;

    for (const child of node.children)
    {
        total += countTips(child, nodes);
    }

    return total;
}

/**
 * Removes nodes with a single child, reconnecting the child to the grandparent.
 *
 * @param nodes - Node lookup, modified in place.
 * @param tips - Tip lookup, modified in place.
 */
function collapseUnaryNodes(nodes: Map<string, TreeNode>, tips: Map<string, Tip>): void
{
    let changed = true;

    while (changed)
    {
        changed = false;

        for (const node of [...nodes.values()])
        {
            if (node.children.length !== 1)
            {
                continue;
            }

            const childId = node.children[0];
            const child = nodes.get(childId) ?? tips.get(childId);

            if (child !== undefined)
            {
                child.parent = node.parent;
            }

            const parent = node.parent === null ? undefined : nodes.get(node.parent);

            if (parent !== undefined)
            {
                const index = parent.children.indexOf(node.id);

                if (index >= 0)
                {
                    parent.children[index] = childId;
                }
            }

            nodes.delete(node.id);
            changed = true;
        }
    }
}

/**
 * Renumbers tips so that those in the main tree come first, top to bottom, followed by the rest.
 *
 * @param nodes - Node lookup, whose child references are rewritten.
 * @param tips - Tip lookup, rebuilt in place.
 * @param root - Root of the main tree, or null.
 */
function renumberTips(nodes: Map<string, TreeNode>, tips: Map<string, Tip>, root: string | null): void
{
    const inTree = new Set<string>();

    function visit(id: string): void
    {
        const node = nodes.get(id);

        if (node === undefined)
        {
            inTree.add(id);

            return;
        }

        for (const child of node.children)
        {
            visit(child);
        }
    }

    function compareTips(left: Tip, right: Tip): number
    {
        return Number(inTree.has(right.id)) - Number(inTree.has(left.id)) || left.y - right.y;
    }

    if (root !== null)
    {
        visit(root);
    }

    const ordered = [...tips.values()].sort(compareTips);
    const renamed = new Map<string, string>();

    for (let index = 0; index < ordered.length; index++)
    {
        renamed.set(ordered[index].id, `t${index + 1}`);
    }

    for (const node of nodes.values())
    {
        for (let index = 0; index < node.children.length; index++)
        {
            node.children[index] = renamed.get(node.children[index]) ?? node.children[index];
        }
    }

    tips.clear();

    for (const tip of ordered)
    {
        tip.id = renamed.get(tip.id) as string;
        tips.set(tip.id, tip);
    }
}

/**
 * Traces a rectangular tree from its segments.
 *
 * @param horizontals - Horizontal segments.
 * @param verticals - Vertical segments.
 * @param tolerance - Largest gap, in pixels, across which a branch end still attaches to a vertical.
 * @param looseTolerance - Fallback attachment distance for branch ends left short by label boxes.
 * @param labelBoxes - Boxes of text rows, used to place the junction of a bridged node.
 * @param labelReach - How far left of a vertical its support label may sit.
 * @param labelRows - Boxes of tip-label-sized text rows, for zero-length branches.
 * @param gluedReach - Largest gap between a vertical and a label that still counts as glued.
 * @returns Nodes, tips, root and findings.
 */
export function traceRectangularTree(
    horizontals: Array<Segment>,
    verticals: Array<Segment>,
    tolerance: number,
    looseTolerance = tolerance,
    labelBoxes: Array<Box> = [],
    labelReach = 0,
    labelRows: Array<Box> = [],
    gluedReach = 0,
    connectors: Set<string> = new Set<string>(),
): TraceResult
{
    const issues = new Array<QcIssue>();
    const candidates = new Array<Candidate>();

    for (const vertical of verticals)
    {
        candidates.push({
            id: vertical.id,
            x: (vertical.box.x0 + vertical.box.x1) / 2,
            y0: vertical.box.y0,
            y1: vertical.box.y1,
            children: [],
            parents: [],
        });
    }

    const branches = splitAtCrossings(horizontals, candidates, tolerance);
    addGluedBranches(branches, candidates, labelRows, tolerance, gluedReach);
    const rejected = new Array<RejectedVertical>();
    const active = attachAndPrune(branches, candidates, tolerance, looseTolerance, rejected);
    const usedSegments = new Set<string>();

    for (const candidate of active)
    {
        usedSegments.add(candidate.id);
    }

    for (const branch of branches)
    {
        if (branch.left !== null || branch.right !== null)
        {
            usedSegments.add(branch.segment);
        }
    }

    const ordered = [...active].sort(compareCandidatePositions);
    const nodeIds = new Map<Candidate, string>();

    for (let index = 0; index < ordered.length; index++)
    {
        nodeIds.set(ordered[index], `n${index + 1}`);
    }

    // Only one incoming branch is a vertical's parent. Another piece arriving at the parent's
    // height is a fragment of the same branch; one arriving at the height of one of the
    // vertical's children is that child's branch running on past the vertical; both are dropped.
    // One arriving at any other height is usually a tip whose branch ends within loose reach of
    // the next vertical, as in a staircase layout; it becomes a tip, since otherwise its subtree
    // would hang from two parents.
    for (const candidate of ordered)
    {
        const primary = choosePrimaryParent(candidate, tolerance);

        for (const branch of candidate.parents)
        {
            if (branch === primary)
            {
                continue;
            }

            branch.right = null;
            const fragment = (primary !== null && Math.abs(branch.y - primary.y) <= tolerance) || isAtChildHeight(branch, candidate, tolerance);

            if (fragment && branch.left !== null)
            {
                const index = branch.left.children.indexOf(branch);

                if (index >= 0)
                {
                    branch.left.children.splice(index, 1);
                }

                branch.left = null;
            }
        }

        candidate.parents = primary === null ? [] : [primary];
    }

    // A connector that found no vertical at its right end joins nothing; it is taken off its
    // left vertical rather than left to become a tip.
    for (const branch of branches)
    {
        if (branch.right === null && branch.left !== null && connectors.has(branch.segment))
        {
            const index = branch.left.children.indexOf(branch);

            if (index >= 0)
            {
                branch.left.children.splice(index, 1);
            }

            branch.left = null;
        }
    }

    const tipBranches = new Array<Branch>();

    for (const branch of branches)
    {
        if (branch.right === null && branch.left !== null)
        {
            tipBranches.push(branch);
        }
    }

    tipBranches.sort(compareBranchHeights);
    const tipIds = new Map<Branch, string>();
    const tips = new Map<string, Tip>();

    for (let index = 0; index < tipBranches.length; index++)
    {
        const branch = tipBranches[index];
        const id = `t${index + 1}`;
        tipIds.set(branch, id);
        tips.set(id, {
            id,
            x: branch.x1,
            y: branch.y,
            parent: branch.left === null ? null : (nodeIds.get(branch.left) ?? null),
            textLine: null,
            label: null,
            match: null,
            source: "traced",
            age: null,
        });
    }

    let noise = 0;

    for (const branch of branches)
    {
        if (branch.left === null && branch.right === null)
        {
            noise++;
        }
    }

    if (noise > 0)
    {
        issues.push({
            severity: "info",
            code: "unattached-horizontals",
            message: `${noise} horizontal segment(s) attach to nothing and were ignored`,
            subject: null,
        });
    }

    const nodes = new Map<string, TreeNode>();

    for (const candidate of ordered)
    {
        const id = nodeIds.get(candidate) as string;
        const parentBranch = choosePrimaryParent(candidate, tolerance);
        candidate.children.sort(compareBranchHeights);
        const children = new Array<string>();

        for (const branch of candidate.children)
        {
            const childId = branch.right === null ? (tipIds.get(branch) as string) : (nodeIds.get(branch.right) as string);

            if (!children.includes(childId))
            {
                children.push(childId);
            }
        }

        nodes.set(id, {
            id,
            x: candidate.x,
            y0: candidate.y0,
            y1: candidate.y1,
            attachY: parentBranch === null ? null : parentBranch.y,
            parent: parentBranch === null || parentBranch.left === null ? null : (nodeIds.get(parentBranch.left) ?? null),
            children,
            textLine: null,
            label: null,
            source: "traced",
            age: null,
        });
    }

    bridgeOrphans(nodes, tips, looseTolerance, tolerance, labelBoxes, labelReach, issues);
    collapseUnaryNodes(nodes, tips);

    let root: string | null = null;
    let rootSize = 0;

    for (const node of nodes.values())
    {
        if (node.parent !== null)
        {
            continue;
        }

        const size = countTips(node.id, nodes);

        if (size > rootSize)
        {
            root = node.id;
            rootSize = size;
        }
    }

    for (const node of nodes.values())
    {
        if (node.parent === null && node.id !== root)
        {
            issues.push({
                severity: "warning",
                code: "disconnected-subtree",
                message: `node ${node.id} roots a disconnected subtree with ${countTips(node.id, nodes)} tip(s)`,
                subject: node.id,
            });
        }
    }

    renumberTips(nodes, tips, root);

    for (const tip of tips.values())
    {
        if (tip.parent === null)
        {
            issues.push({
                severity: "warning",
                code: "disconnected-tip",
                message: `tip ${tip.id} is not connected to any node`,
                subject: tip.id,
            });
        }
    }

    if (root === null)
    {
        issues.push({ severity: "error", code: "no-tree", message: "no connected tree was found", subject: null });
    }

    const records = new Array<BranchRecord>();

    for (const branch of branches)
    {
        records.push({
            id: branch.id,
            x0: branch.x0,
            x1: branch.x1,
            y: branch.y,
            left: branch.left === null ? null : branch.left.id,
            right: branch.right === null ? null : branch.right.id,
        });
    }

    return {
        nodes: [...nodes.values()],
        tips: [...tips.values()],
        root,
        issues,
        usedSegments,
        rejected,
        branches: records,
    };
}
