/**
 * Slanted trees. A slanted cladogram draws every branch as a straight line at whatever angle
 * fits, and a node is a point where lines meet: a tip branch leaves the trunk at a T, two or
 * more lines meet at a Y. Nothing here is horizontal or vertical, so the rectangular tracer's
 * segments do not apply. Instead the line art is thinned to a one-pixel skeleton, and the
 * skeleton is read as a graph: pixels with three or more neighbors are junctions, pixels with
 * one are ends, and the paths between them are branches. The root is the end farthest from
 * every other end, on the side away from the labels, and the tree follows from it. A ring
 * drawn around a node (an open circle) becomes a small cycle in the skeleton and is contracted
 * to a point; stubs the thinning leaves on thick lines are pruned as spurs.
 */

import type { Box, Mask, Point, QcIssue, Tip, TreeNode } from "./types.ts";
import type { TraceResult } from "./tracer.ts";
import { closeMask } from "./raster.ts";

/**
 * A junction or end of the skeleton.
 */
type GraphPoint = {
    /**
     * Index in the point list.
     */
    id: number;

    /**
     * Mean position of its pixels.
     */
    x: number;

    /**
     * Mean position of its pixels.
     */
    y: number;

    /**
     * Edges meeting here, by index.
     */
    edges: Array<number>;

    /**
     * False once merged into another point or dropped.
     */
    alive: boolean;
};

/**
 * A skeleton path between two points.
 */
type GraphEdge = {
    /**
     * Point at one end.
     */
    from: number;

    /**
     * Point at the other end.
     */
    to: number;

    /**
     * Path length in pixels.
     */
    length: number;

    /**
     * The path's pixels, from the first point to the second.
     */
    path: Array<Point>;

    /**
     * False once removed.
     */
    alive: boolean;
};

/**
 * The skeleton as a graph.
 */
type SkeletonGraph = {
    /**
     * Points.
     */
    points: Array<GraphPoint>;

    /**
     * Edges.
     */
    edges: Array<GraphEdge>;
};

/**
 * What the slanted tracer found, beyond the tree.
 */
export type SlantedTrace = {
    /**
     * The tree in the document's terms.
     */
    result: TraceResult;

    /**
     * The one-pixel skeleton the tree was read from, for erasing line art before OCR.
     */
    skeleton: Mask;

    /**
     * Branch paths of the tree, for drawing.
     */
    paths: Array<Array<Point>>;
};

/**
 * Thins a mask to a one-pixel skeleton (Guo and Hall's two-subiteration method). Zhang and
 * Suen's thinning, the usual choice, deletes a two-pixel-wide diagonal outright, and a thick
 * diagonal branch passes through that width on its way down, so whole branches at one of the
 * two slants vanished; this method keeps them.
 *
 * @param mask - Source mask.
 * @returns The skeleton.
 */
export function thinMask(mask: Mask): Mask
{
    const { width, height } = mask;
    const data = new Uint8Array(mask.data);
    const toClear = new Array<number>();

    function at(x: number, y: number): number
    {
        return x < 0 || y < 0 || x >= width || y >= height ? 0 : data[y * width + x];
    }

    let changed = true;

    while (changed)
    {
        changed = false;

        for (let pass = 0; pass < 2; pass++)
        {
            toClear.length = 0;

            for (let y = 0; y < height; y++)
            {
                for (let x = 0; x < width; x++)
                {
                    if (data[y * width + x] === 0)
                    {
                        continue;
                    }

                    const p2 = at(x, y - 1);
                    const p3 = at(x + 1, y - 1);
                    const p4 = at(x + 1, y);
                    const p5 = at(x + 1, y + 1);
                    const p6 = at(x, y + 1);
                    const p7 = at(x - 1, y + 1);
                    const p8 = at(x - 1, y);
                    const p9 = at(x - 1, y - 1);
                    const connectivity = ((p2 === 0 && (p3 === 1 || p4 === 1)) ? 1 : 0)
                        + ((p4 === 0 && (p5 === 1 || p6 === 1)) ? 1 : 0)
                        + ((p6 === 0 && (p7 === 1 || p8 === 1)) ? 1 : 0)
                        + ((p8 === 0 && (p9 === 1 || p2 === 1)) ? 1 : 0);

                    if (connectivity !== 1)
                    {
                        continue;
                    }

                    const first = (p9 | p2) + (p3 | p4) + (p5 | p6) + (p7 | p8);
                    const second = (p2 | p3) + (p4 | p5) + (p6 | p7) + (p8 | p9);
                    const count = Math.min(first, second);

                    if (count < 2 || count > 3)
                    {
                        continue;
                    }

                    const condition = pass === 0 ? ((p2 | p3 | (1 - p5)) & p4) : ((p6 | p7 | (1 - p9)) & p8);

                    if (condition === 0)
                    {
                        toClear.push(y * width + x);
                    }
                }
            }

            for (const index of toClear)
            {
                data[index] = 0;
            }

            changed = changed || toClear.length > 0;
        }
    }

    return { width, height, data };
}

/**
 * Removes the redundant pixels thinning leaves on diagonals and corners: a pixel whose set
 * neighbors are all connected to one another around it is not needed for connectivity, and
 * left in place it makes a run of pixels with three neighbors each, which would read as one
 * long junction. Ends (one neighbor) are kept, or lines would shorten away.
 *
 * @param skeleton - Skeleton mask, cleaned in place.
 */
function removeRedundantPixels(skeleton: Mask): void
{
    const { width, height, data } = skeleton;
    const offsets = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
    let changed = true;

    while (changed)
    {
        changed = false;

        for (let y = 0; y < height; y++)
        {
            for (let x = 0; x < width; x++)
            {
                if (data[y * width + x] === 0)
                {
                    continue;
                }

                const ring = new Array<number>(8);
                let neighbors = 0;

                for (let index = 0; index < 8; index++)
                {
                    const nx = x + offsets[index][0];
                    const ny = y + offsets[index][1];
                    ring[index] = nx < 0 || ny < 0 || nx >= width || ny >= height ? 0 : data[ny * width + nx];
                    neighbors += ring[index];
                }

                if (neighbors < 2)
                {
                    continue;
                }

                // One group of set neighbors, counting two neighbors as joined when they touch
                // each other (the north and east neighbors touch at their corner), means they
                // stay connected without this pixel.
                if (countNeighborGroups(ring, offsets) === 1)
                {
                    data[y * width + x] = 0;
                    changed = true;
                }
            }
        }
    }
}

/**
 * Counts the groups of mutually touching set pixels among the eight neighbors of a pixel.
 *
 * @param ring - Which of the eight neighbors are set, in the offsets' order.
 * @param offsets - The eight neighbor offsets.
 * @returns Number of groups.
 */
function countNeighborGroups(ring: Array<number>, offsets: Array<Array<number>>): number
{
    const group = [0, 1, 2, 3, 4, 5, 6, 7];

    function find(index: number): number
    {
        while (group[index] !== index)
        {
            index = group[index];
        }

        return index;
    }

    for (let first = 0; first < 8; first++)
    {
        if (ring[first] === 0)
        {
            continue;
        }

        for (let second = first + 1; second < 8; second++)
        {
            if (ring[second] === 1 && Math.abs(offsets[first][0] - offsets[second][0]) <= 1 && Math.abs(offsets[first][1] - offsets[second][1]) <= 1)
            {
                group[find(second)] = find(first);
            }
        }
    }

    let groups = 0;

    for (let index = 0; index < 8; index++)
    {
        if (ring[index] === 1 && find(index) === index)
        {
            groups++;
        }
    }

    return groups;
}

/**
 * Counts the set 8-neighbors of a skeleton pixel.
 *
 * @param skeleton - Skeleton mask.
 * @param x - Column.
 * @param y - Row.
 * @returns Neighbor count.
 */
function countNeighbors(skeleton: Mask, x: number, y: number): number
{
    const { width, height, data } = skeleton;
    let count = 0;

    for (let dy = -1; dy <= 1; dy++)
    {
        for (let dx = -1; dx <= 1; dx++)
        {
            if (dx === 0 && dy === 0)
            {
                continue;
            }

            const nx = x + dx;
            const ny = y + dy;

            if (nx >= 0 && ny >= 0 && nx < width && ny < height)
            {
                count += data[ny * width + nx];
            }
        }
    }

    return count;
}

/**
 * Reads the skeleton as a graph: junction pixels (three or more neighbors) and end pixels
 * (one neighbor) become points, adjacent junction pixels one point, and the pixel paths between
 * points become edges.
 *
 * @param skeleton - Skeleton mask.
 * @returns The graph.
 */
function buildGraph(skeleton: Mask): SkeletonGraph
{
    const { width, height, data } = skeleton;
    const degree = new Uint8Array(width * height);
    const pointOf = new Int32Array(width * height).fill(-1);
    const points = new Array<GraphPoint>();
    const edges = new Array<GraphEdge>();

    for (let y = 0; y < height; y++)
    {
        for (let x = 0; x < width; x++)
        {
            if (data[y * width + x] === 1)
            {
                degree[y * width + x] = countNeighbors(skeleton, x, y);
            }
        }
    }

    // Points: junction pixels flood-filled together, ends on their own.
    const stack = new Array<number>();

    for (let y = 0; y < height; y++)
    {
        for (let x = 0; x < width; x++)
        {
            const index = y * width + x;

            if (data[index] === 0 || pointOf[index] >= 0 || degree[index] === 2)
            {
                continue;
            }

            const point: GraphPoint = { id: points.length, x: 0, y: 0, edges: [], alive: true };
            let count = 0;
            stack.push(index);
            pointOf[index] = point.id;

            while (stack.length > 0)
            {
                const current = stack.pop() as number;
                const cx = current % width;
                const cy = (current - cx) / width;
                point.x += cx;
                point.y += cy;
                count++;

                if (degree[current] < 3)
                {
                    continue;
                }

                for (let dy = -1; dy <= 1; dy++)
                {
                    for (let dx = -1; dx <= 1; dx++)
                    {
                        const nx = cx + dx;
                        const ny = cy + dy;

                        if (nx < 0 || ny < 0 || nx >= width || ny >= height)
                        {
                            continue;
                        }

                        const next = ny * width + nx;

                        if (data[next] === 1 && pointOf[next] < 0 && degree[next] >= 3)
                        {
                            pointOf[next] = point.id;
                            stack.push(next);
                        }
                    }
                }
            }

            point.x /= count;
            point.y /= count;
            points.push(point);
        }
    }

    // Edges: walk from every point pixel along degree-2 pixels to the next point pixel.
    const visited = new Uint8Array(width * height);

    function walk(startPixel: number, firstPixel: number): void
    {
        const startPoint = pointOf[startPixel];
        const path: Array<Point> = [{ x: startPixel % width, y: Math.floor(startPixel / width) }];
        const walked = new Array<number>();
        let previous = startPixel;
        let current = firstPixel;
        let length = Math.hypot(path[0].x - (current % width), path[0].y - Math.floor(current / width));

        while (pointOf[current] < 0)
        {
            walked.push(current);
            const cx = current % width;
            const cy = (current - cx) / width;
            path.push({ x: cx, y: cy });
            let next = -1;

            for (let dy = -1; dy <= 1; dy++)
            {
                for (let dx = -1; dx <= 1; dx++)
                {
                    const nx = cx + dx;
                    const ny = cy + dy;

                    if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= width || ny >= height)
                    {
                        continue;
                    }

                    const candidate = ny * width + nx;

                    if (data[candidate] === 0 || candidate === previous || walked.includes(candidate))
                    {
                        continue;
                    }

                    // The first step must leave the start point's own pixels; later, a point
                    // pixel of another point ends the path, and a free pixel continues it.
                    if (pointOf[candidate] === startPoint && path.length <= 2)
                    {
                        continue;
                    }

                    if (pointOf[candidate] >= 0)
                    {
                        next = candidate;
                        break;
                    }

                    if (next < 0 && visited[candidate] === 0)
                    {
                        next = candidate;
                    }
                }

                if (next >= 0 && pointOf[next] >= 0)
                {
                    break;
                }
            }

            if (next < 0)
            {
                // A dead end on a pixel that is not a point: leave the pixels for another walk.
                return;
            }

            length += Math.hypot((next % width) - cx, Math.floor(next / width) - cy);
            previous = current;
            current = next;
        }

        for (const pixel of walked)
        {
            visited[pixel] = 1;
        }

        const endPoint = pointOf[current];

        if (endPoint === startPoint && path.length < 3)
        {
            return;
        }

        path.push({ x: current % width, y: Math.floor(current / width) });
        const edge: GraphEdge = { from: startPoint, to: endPoint, length, path, alive: true };
        points[startPoint].edges.push(edges.length);
        points[endPoint].edges.push(edges.length);
        edges.push(edge);
    }

    for (let y = 0; y < height; y++)
    {
        for (let x = 0; x < width; x++)
        {
            const index = y * width + x;

            if (data[index] === 0 || pointOf[index] < 0)
            {
                continue;
            }

            for (let dy = -1; dy <= 1; dy++)
            {
                for (let dx = -1; dx <= 1; dx++)
                {
                    const nx = x + dx;
                    const ny = y + dy;

                    if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= width || ny >= height)
                    {
                        continue;
                    }

                    const next = ny * width + nx;

                    if (data[next] === 1 && pointOf[next] < 0 && visited[next] === 0)
                    {
                        walk(index, next);
                    }
                    else if (data[next] === 1 && pointOf[next] >= 0 && pointOf[next] !== pointOf[index] && pointOf[next] > pointOf[index])
                    {
                        // Two points touching with no path between them.
                        const edge: GraphEdge = { from: pointOf[index], to: pointOf[next], length: Math.hypot(dx, dy), path: [{ x, y }, { x: nx, y: ny }], alive: true };
                        points[pointOf[index]].edges.push(edges.length);
                        points[pointOf[next]].edges.push(edges.length);
                        edges.push(edge);
                    }
                }
            }
        }
    }

    return { points, edges };
}

/**
 * Live edges at a point.
 *
 * @param graph - Graph.
 * @param point - Point.
 * @returns Edge indices.
 */
function listLiveEdges(graph: SkeletonGraph, point: GraphPoint): Array<number>
{
    const live = new Array<number>();

    for (const index of point.edges)
    {
        if (graph.edges[index].alive)
        {
            live.push(index);
        }
    }

    return live;
}

/**
 * The point at the other end of an edge.
 *
 * @param edge - Edge.
 * @param point - A point of the edge.
 * @returns The other point's index.
 */
function otherEnd(edge: GraphEdge, point: number): number
{
    return edge.from === point ? edge.to : edge.from;
}

/**
 * Removes short dead-end edges (spurs the thinning leaves on thick lines and corners), and
 * joins the two edges of any point left with just two, until nothing changes.
 *
 * @param graph - Graph changed in place.
 * @param maxSpur - Longest spur to remove, in pixels.
 * @param anchors - Marker pixels; an end whose stub runs into one is a tip and stays.
 * @returns Spurs removed.
 */
function pruneSpurs(graph: SkeletonGraph, maxSpur: number, anchors: Mask | null = null): number
{
    let removed = 0;
    let changed = true;
    const reach = Math.max(3, Math.round(maxSpur));

    // An end whose stub runs into a marker (a filled triangle or disc at a tip) is a tip
    // however short the stub: two tips forking just before the tip line are read that way.
    // The marker must lie ahead of the end along the stub, not merely beside it, or a spur
    // next to a bold clade name would pass.
    function isAnchored(point: GraphPoint, edge: GraphEdge): boolean
    {
        if (anchors === null || edge.path.length < 2)
        {
            return false;
        }

        const path = edge.to === point.id ? edge.path : [...edge.path].reverse();
        const end = path[path.length - 1];

        // Along the last few pixels, and along the whole stub, since a thick stub's end thins
        // into a prong that may point aside.
        for (const back of [path[Math.max(0, path.length - 5)], path[0]])
        {
            const dx = end.x - back.x;
            const dy = end.y - back.y;
            const length = Math.hypot(dx, dy);

            if (length < 1e-6)
            {
                continue;
            }

            for (let step = 1; step <= reach; step++)
            {
                const x = Math.round(end.x + (dx / length) * step);
                const y = Math.round(end.y + (dy / length) * step);

                for (let oy = -1; oy <= 1; oy++)
                {
                    for (let ox = -1; ox <= 1; ox++)
                    {
                        const nx = x + ox;
                        const ny = y + oy;

                        if (nx >= 0 && ny >= 0 && nx < anchors.width && ny < anchors.height && anchors.data[ny * anchors.width + nx] === 1)
                        {
                            return true;
                        }
                    }
                }
            }
        }

        return false;
    }

    while (changed)
    {
        changed = false;

        for (const point of graph.points)
        {
            if (!point.alive)
            {
                continue;
            }

            const live = listLiveEdges(graph, point);

            if (live.length === 1)
            {
                const edge = graph.edges[live[0]];
                const other = graph.points[otherEnd(edge, point.id)];

                // A dead end hanging off a junction by less than a spur's length.
                if (edge.length <= maxSpur && listLiveEdges(graph, other).length >= 3 && !isAnchored(point, edge))
                {
                    edge.alive = false;
                    point.alive = false;
                    removed++;
                    changed = true;
                }
            }
            else if (live.length === 2)
            {
                joinThrough(graph, point, live[0], live[1]);
                changed = true;
            }
            else if (live.length === 0)
            {
                point.alive = false;
            }
        }
    }

    return removed;
}

/**
 * Replaces the two edges of a pass-through point by one edge joining their far ends.
 *
 * @param graph - Graph changed in place.
 * @param point - The pass-through point.
 * @param first - One edge.
 * @param second - The other edge.
 */
function joinThrough(graph: SkeletonGraph, point: GraphPoint, first: number, second: number): void
{
    const a = graph.edges[first];
    const b = graph.edges[second];
    const start = otherEnd(a, point.id);
    const end = otherEnd(b, point.id);
    const pathA = a.from === start ? a.path : [...a.path].reverse();
    const pathB = b.from === point.id ? b.path : [...b.path].reverse();
    const edge: GraphEdge = { from: start, to: end, length: a.length + b.length, path: [...pathA, ...pathB.slice(1)], alive: true };
    a.alive = false;
    b.alive = false;
    point.alive = false;
    graph.points[start].edges.push(graph.edges.length);
    graph.points[end].edges.push(graph.edges.length);
    graph.edges.push(edge);
}

/**
 * Merges a group of points into one at the middle of their extent, keeping the edges that
 * leave the group and dropping those inside it.
 *
 * @param graph - Graph changed in place.
 * @param group - Point ids, the first of which is kept.
 */
function mergePoints(graph: SkeletonGraph, group: Array<number>): void
{
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;

    for (const id of group)
    {
        x0 = Math.min(x0, graph.points[id].x);
        y0 = Math.min(y0, graph.points[id].y);
        x1 = Math.max(x1, graph.points[id].x);
        y1 = Math.max(y1, graph.points[id].y);
    }

    const keeper = graph.points[group[0]];
    keeper.x = (x0 + x1) / 2;
    keeper.y = (y0 + y1) / 2;
    const inGroup = new Set(group);

    for (const id of group.slice(1))
    {
        const point = graph.points[id];

        for (const index of listLiveEdges(graph, point))
        {
            const edge = graph.edges[index];

            if (inGroup.has(edge.from) && inGroup.has(edge.to))
            {
                edge.alive = false;
                continue;
            }

            if (edge.from === id)
            {
                edge.from = keeper.id;
            }
            else
            {
                edge.to = keeper.id;
            }

            keeper.edges.push(index);
        }

        point.alive = false;
    }

    for (const index of listLiveEdges(graph, keeper))
    {
        const edge = graph.edges[index];

        if (edge.from === keeper.id && edge.to === keeper.id)
        {
            edge.alive = false;
        }
    }
}

/**
 * Extent of a group of points: the larger side of their bounding box.
 *
 * @param graph - Graph.
 * @param group - Point ids.
 * @returns Extent in pixels.
 */
function measureExtent(graph: SkeletonGraph, group: Array<number>): number
{
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;

    for (const id of group)
    {
        x0 = Math.min(x0, graph.points[id].x);
        y0 = Math.min(y0, graph.points[id].y);
        x1 = Math.max(x1, graph.points[id].x);
        y1 = Math.max(y1, graph.points[id].y);
    }

    return Math.max(x1 - x0, y1 - y0);
}

/**
 * Contracts chains: junction points joined by edges shorter than a glyph, which is one thick
 * junction thinned into two or three, or the first forks of a fan.
 *
 * @param graph - Graph changed in place.
 * @param maxEdge - Longest edge inside a chain.
 * @param maxExtent - Largest extent of a chain.
 * @returns Chains contracted.
 */
function contractChains(graph: SkeletonGraph, maxEdge: number, maxExtent: number): number
{
    const groupOf = new Int32Array(graph.points.length).fill(-1);
    const groups = new Array<Array<number>>();

    for (const point of graph.points)
    {
        if (!point.alive || groupOf[point.id] >= 0 || listLiveEdges(graph, point).length < 3)
        {
            continue;
        }

        const group = [point.id];
        groupOf[point.id] = groups.length;

        for (let cursor = 0; cursor < group.length; cursor++)
        {
            const current = graph.points[group[cursor]];

            for (const index of listLiveEdges(graph, current))
            {
                const edge = graph.edges[index];
                const other = graph.points[otherEnd(edge, current.id)];

                if (edge.length <= maxEdge && other.alive && groupOf[other.id] < 0 && listLiveEdges(graph, other).length >= 3)
                {
                    groupOf[other.id] = groups.length;
                    group.push(other.id);
                }
            }
        }

        groups.push(group);
    }

    let contracted = 0;

    for (const group of groups)
    {
        if (group.length >= 2 && measureExtent(graph, group) <= maxExtent)
        {
            mergePoints(graph, group);
            contracted++;
        }
    }

    return contracted;
}

/**
 * Contracts rings: short cycles of junction points within a small extent, which is what an
 * open circle drawn around a node becomes. A cycle is looked for from each junction through
 * at most four short edges.
 *
 * @param graph - Graph changed in place.
 * @param maxEdge - Longest edge inside a ring (an arc between two attachments).
 * @param maxExtent - Largest extent of a ring.
 * @returns Rings contracted.
 */
function contractRings(graph: SkeletonGraph, maxEdge: number, maxExtent: number): number
{
    let contracted = 0;

    for (const start of graph.points)
    {
        if (!start.alive || listLiveEdges(graph, start).length < 3)
        {
            continue;
        }

        const cycle = findShortCycle(graph, start.id, maxEdge, 4);

        if (cycle !== null && measureExtent(graph, cycle) <= maxExtent)
        {
            mergePoints(graph, cycle);
            contracted++;
        }
    }

    return contracted;
}

/**
 * Finds a cycle through a point made of short edges, by depth-first search.
 *
 * @param graph - Graph.
 * @param start - Point to start and end at.
 * @param maxEdge - Longest edge allowed.
 * @param maxDepth - Most edges in the cycle.
 * @returns The cycle's point ids, or null.
 */
function findShortCycle(graph: SkeletonGraph, start: number, maxEdge: number, maxDepth: number): Array<number> | null
{
    const path = [start];
    const usedEdges = new Set<number>();

    function search(current: number, depth: number): boolean
    {
        for (const index of listLiveEdges(graph, graph.points[current]))
        {
            const edge = graph.edges[index];

            if (usedEdges.has(index) || edge.length > maxEdge)
            {
                continue;
            }

            const next = otherEnd(edge, current);

            // Back at the start over a second edge at least: a cycle.
            if (next === start && depth >= 1)
            {
                return true;
            }

            if (path.includes(next) || depth + 1 >= maxDepth || !graph.points[next].alive)
            {
                continue;
            }

            usedEdges.add(index);
            path.push(next);

            if (search(next, depth + 1))
            {
                return true;
            }

            path.pop();
            usedEdges.delete(index);
        }

        return false;
    }

    return search(start, 0) ? path : null;
}

/**
 * Connected components of the live graph, as point id lists.
 *
 * @param graph - Graph.
 * @returns The components.
 */
function listComponents(graph: SkeletonGraph): Array<Array<number>>
{
    const seen = new Uint8Array(graph.points.length);
    const components = new Array<Array<number>>();

    for (const point of graph.points)
    {
        if (!point.alive || seen[point.id] === 1)
        {
            continue;
        }

        const component = [point.id];
        seen[point.id] = 1;

        for (let cursor = 0; cursor < component.length; cursor++)
        {
            const current = graph.points[component[cursor]];

            for (const index of listLiveEdges(graph, current))
            {
                const other = otherEnd(graph.edges[index], current.id);

                if (seen[other] === 0 && graph.points[other].alive)
                {
                    seen[other] = 1;
                    component.push(other);
                }
            }
        }

        components.push(component);
    }

    return components;
}

/**
 * Shortest path lengths from one point to every point of its component (Dijkstra over the
 * few hundred points a figure has).
 *
 * @param graph - Graph.
 * @param source - Start point.
 * @returns Distances by point id; infinity where unreached.
 */
function measureDistances(graph: SkeletonGraph, source: number): Float64Array
{
    const distances = new Float64Array(graph.points.length).fill(Infinity);
    const done = new Uint8Array(graph.points.length);
    distances[source] = 0;

    for (;;)
    {
        let current = -1;

        for (let id = 0; id < graph.points.length; id++)
        {
            if (done[id] === 0 && distances[id] < Infinity && (current < 0 || distances[id] < distances[current]))
            {
                current = id;
            }
        }

        if (current < 0)
        {
            break;
        }

        done[current] = 1;

        for (const index of listLiveEdges(graph, graph.points[current]))
        {
            const edge = graph.edges[index];
            const other = otherEnd(edge, current);

            if (distances[current] + edge.length < distances[other])
            {
                distances[other] = distances[current] + edge.length;
            }
        }
    }

    return distances;
}

/**
 * The tips' side of a component: the unit direction from the middle of its points to the
 * middle of its ends, since the ends are the tips, all but one.
 *
 * @param graph - Graph.
 * @param component - Point ids of the component.
 * @returns The direction, or null without ends.
 */
function measureTipSide(graph: SkeletonGraph, component: Array<number>): Point | null
{
    let sumX = 0;
    let sumY = 0;
    let endSumX = 0;
    let endSumY = 0;
    let ends = 0;

    for (const id of component)
    {
        const point = graph.points[id];
        sumX += point.x;
        sumY += point.y;

        if (listLiveEdges(graph, point).length === 1)
        {
            endSumX += point.x;
            endSumY += point.y;
            ends++;
        }
    }

    if (ends === 0)
    {
        return null;
    }

    const dx = endSumX / ends - sumX / component.length;
    const dy = endSumY / ends - sumY / component.length;
    const length = Math.hypot(dx, dy);

    return length < 1e-6 ? { x: 1, y: 0 } : { x: dx / length, y: dy / length };
}

/**
 * Chooses the root among a component's ends. The root is the end farthest back from the
 * tips' side and alone there: each end scores how far back it lies from the most forward end
 * plus how far it is from its nearest other end, so a leader line's end on the root side,
 * which has other leaders' ends close by, loses to the root stub, and a short spur in the
 * middle of the figure loses to both.
 *
 * @param graph - Graph.
 * @param component - Point ids of the component.
 * @param side - The tips' side.
 * @param textBoxes - Boxes of text rows; an end with text beside it is a leader's, not the root.
 * @param reach - How near text must be to count, in pixels.
 * @returns The root end's id, or -1 without ends.
 */
function chooseRootEnd(graph: SkeletonGraph, component: Array<number>, side: Point, textBoxes: Array<Box>, reach: number): number
{
    const ends = new Array<number>();
    const candidates = new Array<number>();

    for (const id of component)
    {
        const point = graph.points[id];

        if (listLiveEdges(graph, point).length !== 1)
        {
            continue;
        }

        ends.push(id);

        // A leader line ends at its label; the root stub ends in nothing.
        if (!hasTextNear(textBoxes, point.x, point.y, reach))
        {
            candidates.push(id);
        }
    }

    if (ends.length === 0)
    {
        return -1;
    }

    if (candidates.length === 0)
    {
        candidates.push(...ends);
    }

    const sideX = side.x;
    const sideY = side.y;
    let mostForward = -Infinity;

    for (const id of ends)
    {
        mostForward = Math.max(mostForward, graph.points[id].x * sideX + graph.points[id].y * sideY);
    }

    let best = -1;
    let bestScore = -Infinity;

    for (const id of candidates)
    {
        const point = graph.points[id];
        const back = mostForward - (point.x * sideX + point.y * sideY);
        const distances = measureDistances(graph, id);
        let nearest = Infinity;

        for (const other of ends)
        {
            if (other !== id)
            {
                nearest = Math.min(nearest, distances[other]);
            }
        }

        const score = back + Math.min(nearest, back);

        if (score > bestScore)
        {
            bestScore = score;
            best = id;
        }
    }

    return best;
}

/**
 * Removes leader lines: ends of the component whose last stretch points away from the side
 * the tips are on. A tip's branch runs toward the tips; a line from a node to a clade name or
 * a support value printed on the root side runs the other way. Points left with two edges are
 * joined through.
 *
 * @param graph - Graph changed in place.
 * @param component - Point ids of the main component.
 * @param rootEnd - The root end, which also points away and is kept.
 * @param side - The tips' side.
 * @param glyphHeight - Glyph height in pixels.
 * @returns Leaders removed.
 */
function pruneLeaders(graph: SkeletonGraph, component: Array<number>, rootEnd: number, side: Point, glyphHeight: number): number
{
    const sideX = side.x;
    const sideY = side.y;
    const sideLength = 1;
    let removed = 0;
    let changed = true;

    // Removing a leader can leave a new end (the stroke of a bracket it ran into), which is
    // judged in turn.
    while (changed)
    {
        changed = false;

        for (const id of component)
        {
            const point = graph.points[id];

            if (id === rootEnd || !point.alive)
            {
                continue;
            }

            const live = listLiveEdges(graph, point);

            if (live.length !== 1)
            {
                continue;
            }

            const edge = graph.edges[live[0]];
            const path = edge.to === id ? edge.path : [...edge.path].reverse();
            // The direction of the last stretch, about two glyphs back from the end.
            let back = path.length - 1;
            let run = 0;

            while (back > 0 && run < 2 * glyphHeight)
            {
                run += Math.hypot(path[back].x - path[back - 1].x, path[back].y - path[back - 1].y);
                back--;
            }

            const dx = path[path.length - 1].x - path[back].x;
            const dy = path[path.length - 1].y - path[back].y;
            const length = Math.hypot(dx, dy);

            if (length < 1e-6)
            {
                continue;
            }

            // Away from the tips (well away: the lower stub of a forked pair points somewhat down
            // and is a tip), or level and long: a slanted figure's branches slant, and a level
            // line running out to a bracketed number beyond the labels is a leader. The level test
            // looks at the stretch before the last two glyphs as well, since the bracket's own
            // stroke turns the line's last pixels.
            const away = (dx * sideX + dy * sideY) / (length * sideLength) < -0.5;
            const level = edge.length >= 2 * glyphHeight && (isLevelStretch(path, 0, 2 * glyphHeight) || isLevelStretch(path, 2 * glyphHeight, 4 * glyphHeight));

            if (away || level)
            {
                edge.alive = false;
                point.alive = false;
                removed++;
                changed = true;
                const other = graph.points[otherEnd(edge, id)];
                const remaining = listLiveEdges(graph, other);

                if (remaining.length === 2)
                {
                    joinThrough(graph, other, remaining[0], remaining[1]);
                }
            }
        }
    }

    return removed;
}

/**
 * Direction of a branch's straight stretch: from the point three glyphs along the path to the
 * point ten glyphs along, past the bend the skeleton makes where thick lines part, or over
 * what there is of a shorter path.
 *
 * @param path - Path from a node toward its child.
 * @param glyphHeight - Glyph height in pixels.
 * @returns A unit direction, or null for a path too short to have one.
 */
function measureStraightDirection(path: Array<Point>, glyphHeight: number): Point | null
{
    const distances = new Array<number>(path.length);
    distances[0] = 0;

    for (let index = 1; index < path.length; index++)
    {
        distances[index] = distances[index - 1] + Math.hypot(path[index].x - path[index - 1].x, path[index].y - path[index - 1].y);
    }

    const total = distances[path.length - 1];
    const from = total > 6 * glyphHeight ? 3 * glyphHeight : 0;
    const to = Math.min(total, 10 * glyphHeight);
    let first = 0;
    let last = path.length - 1;

    while (first < path.length - 1 && distances[first] < from)
    {
        first++;
    }

    while (last > first && distances[last] > to)
    {
        last--;
    }

    const dx = path[last].x - path[first].x;
    const dy = path[last].y - path[first].y;
    const length = Math.hypot(dx, dy);

    return length < 1e-6 ? null : { x: dx / length, y: dy / length };
}

/**
 * Moves branches up to the junction they really leave from. A fan of lines spreading from one
 * point thins into a chain of forks, each a little further along; at such a fork two or more
 * of the lines, followed back, pass through an earlier fork of the chain, and each belongs to
 * the farthest fork its line passes through. At a fork of a pectinate tree only the trunk's
 * own continuation runs back through the forks before, and that one stays. Forks left with
 * one branch dissolve. Repeated until nothing moves.
 *
 * @param nodes - Traced nodes, changed in place.
 * @param tips - Traced tips, changed in place.
 * @param pathToChild - Skeleton path from each child's parent to the child.
 * @param tolerance - How close to the earlier junction the line must pass, in pixels.
 * @param glyphHeight - Glyph height in pixels.
 * @returns Branches moved.
 */
function collapseFans(nodes: Array<TreeNode>, tips: Array<Tip>, pathToChild: Map<string, Array<Point>>, tolerance: number, glyphHeight: number): number
{
    const nodeById = new Map<string, TreeNode>();
    const tipById = new Map<string, Tip>();

    for (const node of nodes)
    {
        nodeById.set(node.id, node);
    }

    for (const tip of tips)
    {
        tipById.set(tip.id, tip);
    }

    function setParent(childId: string, parentId: string): void
    {
        const node = nodeById.get(childId);

        if (node !== undefined)
        {
            node.parent = parentId;
        }

        const tip = tipById.get(childId);

        if (tip !== undefined)
        {
            tip.parent = parentId;
        }
    }

    let moved = 0;
    let changed = true;

    while (changed)
    {
        changed = false;

        for (const node of nodes)
        {
            const parent = node.parent === null ? null : nodeById.get(node.parent);

            if (parent === undefined || parent === null || node.children.length === 0)
            {
                continue;
            }

            const passing = new Map<string, TreeNode>();

            for (const childId of node.children)
            {
                const path = pathToChild.get(childId);
                const direction = path === undefined ? null : measureStraightDirection(path, glyphHeight);

                if (direction === null)
                {
                    continue;
                }

                // The farthest ancestor, within reach, that the branch's line runs back through.
                let ancestor: TreeNode | undefined = parent;
                let farthest: TreeNode | null = null;

                while (ancestor !== undefined)
                {
                    const toAncestorX = ancestor.x - node.x;
                    const toAncestorY = (ancestor.attachY ?? ancestor.y0) - (node.attachY ?? node.y0);
                    const along = toAncestorX * direction.x + toAncestorY * direction.y;
                    const across = Math.abs(toAncestorX * direction.y - toAncestorY * direction.x);

                    // Only the forks close behind: a fan's forks lie within a few glyphs of one
                    // another, and further back the risk of a chance alignment grows.
                    if (-along > 3 * glyphHeight)
                    {
                        break;
                    }

                    // A little angular slack over the distance back.
                    if (along < 0 && across <= tolerance + 0.03 * -along)
                    {
                        farthest = ancestor;
                    }

                    ancestor = ancestor.parent === null ? undefined : nodeById.get(ancestor.parent);
                }

                if (farthest !== null)
                {
                    passing.set(childId, farthest);
                }
            }

            if (passing.size < 2)
            {
                continue;
            }

            for (const [childId, target] of passing)
            {
                node.children.splice(node.children.indexOf(childId), 1);
                target.children.push(childId);
                setParent(childId, target.id);
                moved++;
                changed = true;
            }
        }

        // A fork left with one branch is no fork: its branch moves up and it goes.
        for (const node of [...nodes])
        {
            if (node.children.length !== 1 || node.parent === null)
            {
                continue;
            }

            const parent = nodeById.get(node.parent);

            if (parent === undefined)
            {
                continue;
            }

            const only = node.children[0];
            parent.children.splice(parent.children.indexOf(node.id), 1, only);
            setParent(only, parent.id);
            const joined = pathToChild.get(node.id);
            const rest = pathToChild.get(only);

            if (joined !== undefined && rest !== undefined)
            {
                pathToChild.set(only, [...joined, ...rest.slice(1)]);
            }

            nodes.splice(nodes.indexOf(node), 1);
            nodeById.delete(node.id);
            changed = true;
        }
    }

    return moved;
}

/**
 * Whether any text box lies within reach of a point.
 *
 * @param textBoxes - Boxes of text rows.
 * @param x - Point x.
 * @param y - Point y.
 * @param reach - Distance in pixels.
 * @returns True when text is near.
 */
function hasTextNear(textBoxes: Array<Box>, x: number, y: number, reach: number): boolean
{
    for (const box of textBoxes)
    {
        const dx = Math.max(box.x0 - x, 0, x - box.x1);
        const dy = Math.max(box.y0 - y, 0, y - box.y1);

        if (Math.hypot(dx, dy) <= reach)
        {
            return true;
        }
    }

    return false;
}

/**
 * Whether the stretch of a path between two distances back from its end runs level.
 *
 * @param path - Path ending at the end in question.
 * @param from - Distance back from the end where the stretch starts.
 * @param to - Distance back from the end where the stretch ends.
 * @returns True when the stretch is at least a glyph long and within ten degrees of level.
 */
function isLevelStretch(path: Array<Point>, from: number, to: number): boolean
{
    let near = path.length - 1;
    let run = 0;

    while (near > 0 && run < from)
    {
        run += Math.hypot(path[near].x - path[near - 1].x, path[near].y - path[near - 1].y);
        near--;
    }

    let far = near;

    while (far > 0 && run < to)
    {
        run += Math.hypot(path[far].x - path[far - 1].x, path[far].y - path[far - 1].y);
        far--;
    }

    const dx = path[near].x - path[far].x;
    const dy = path[near].y - path[far].y;
    const length = Math.hypot(dx, dy);

    return length >= (to - from) * 0.5 && Math.abs(dy / length) < 0.17;
}

/**
 * Orders children top to bottom, then left to right.
 *
 * @param left - First child point.
 * @param right - Second child point.
 * @returns Negative when the first comes first.
 */
function compareChildPoints(left: GraphPoint, right: GraphPoint): number
{
    return left.y - right.y || left.x - right.x;
}

/**
 * Which way the ends of the line art lie from its middle: the tips of a tree are its ends, all
 * but one, so this is the tip side.
 *
 * @param lineArt - Line art, large pieces only.
 * @returns A unit step toward the ends, or null without line art.
 */
export function findEndSide(lineArt: Mask): Point | null
{
    const skeleton = thinMask(lineArt);
    const { width, height, data } = skeleton;
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    let endSumX = 0;
    let endSumY = 0;
    let ends = 0;

    for (let y = 0; y < height; y++)
    {
        for (let x = 0; x < width; x++)
        {
            if (data[y * width + x] === 0)
            {
                continue;
            }

            sumX += x;
            sumY += y;
            count++;

            if (countNeighbors(skeleton, x, y) === 1)
            {
                endSumX += x;
                endSumY += y;
                ends++;
            }
        }
    }

    if (count === 0 || ends === 0)
    {
        return null;
    }

    const dx = (endSumX / ends - sumX / count) / width;
    const dy = (endSumY / ends - sumY / count) / height;

    if (Math.max(Math.abs(dx), Math.abs(dy)) < 0.02)
    {
        return null;
    }

    return Math.abs(dx) >= Math.abs(dy) ? { x: dx > 0 ? 1 : -1, y: 0 } : { x: 0, y: dy > 0 ? 1 : -1 };
}

/**
 * Traces a slanted tree from its line art.
 *
 * @param lineInk - Line ink with text removed.
 * @param thickness - Line thickness in pixels.
 * @param glyphHeight - Glyph height in pixels.
 * @param textBoxes - Boxes of the figure's text rows, for telling the root stub from leaders.
 * @param markers - Filled shapes at tips (triangles, discs), whose stubs are kept however short.
 * @returns The trace, with the skeleton and the branch paths.
 */
export function traceSlantedTree(lineInk: Mask, thickness: number, glyphHeight: number, textBoxes: Array<Box> = [], markers: Mask | null = null): SlantedTrace
{
    // A branch that leaves a node circle, or a line broken by a crossing label, can stop a
    // pixel or two short of what it meets; a small closing mends that without merging the
    // close parallel lines of a dense figure.
    const skeleton = thinMask(closeMask(lineInk, Math.max(1, Math.min(3, Math.ceil(thickness / 4)))));
    removeRedundantPixels(skeleton);
    const graph = buildGraph(skeleton);
    // A spur the thinning leaves at a thick line's end is under a line thickness long; a real
    // stub to a tip, where two tips fork just before the tip line, can be little longer.
    const maxSpur = Math.max(0.8 * thickness, 0.3 * glyphHeight);
    const spurs = pruneSpurs(graph, maxSpur, markers);
    // A thick junction thinned into two or three close forks contracts to one, and so does a
    // ring drawn around a node.
    const chains = contractChains(graph, 1.2 * glyphHeight, 3 * glyphHeight);
    const rings = contractRings(graph, 2.5 * glyphHeight, 2.5 * glyphHeight);
    // Contraction can leave pass-through points and new short spurs.
    pruneSpurs(graph, maxSpur, markers);
    const components = listComponents(graph);
    const issues = new Array<QcIssue>();
    const nodes = new Array<TreeNode>();
    const tips = new Array<Tip>();
    const paths = new Array<Array<Point>>();
    let root: string | null = null;
    let main: Array<number> = [];
    let mainEnds = 0;

    for (const component of components)
    {
        let ends = 0;

        for (const id of component)
        {
            ends += listLiveEdges(graph, graph.points[id]).length === 1 ? 1 : 0;
        }

        if (ends > mainEnds)
        {
            mainEnds = ends;
            main = component;
        }
    }

    issues.push({ severity: "info", code: "slanted-traced", message: `slanted tree read from the skeleton: ${components.length} piece(s), the largest with ${mainEnds} end(s); ${spurs} spur(s) pruned, ${chains} close fork(s) and ${rings} ring(s) contracted`, subject: null });

    if (main.length === 0)
    {
        return { result: { nodes, tips, root, issues, usedSegments: new Set(), rejected: [], branches: [] }, skeleton, paths };
    }

    const side = measureTipSide(graph, main) ?? { x: 1, y: 0 };
    const rootEnd = chooseRootEnd(graph, main, side, textBoxes, 2 * glyphHeight);
    const leaders = pruneLeaders(graph, main, rootEnd, side, glyphHeight);

    if (leaders > 0)
    {
        issues.push({ severity: "info", code: "leaders-dropped", message: `${leaders} line(s) pointing away from the tips were dropped as leaders to labels`, subject: null });
    }

    const nodeIdOf = new Map<number, string>();
    const tipIdOf = new Map<number, string>();
    const visited = new Uint8Array(graph.points.length);
    const pathToChild = new Map<string, Array<Point>>();
    let cycles = 0;

    // Walk from the root end: its one edge leads to the first junction, which is the root node.
    // A cycle the ring contraction did not close (a frame, a box) is cut at its back edge.
    function visit(pointId: number, cameFrom: number, parentNodeId: string | null): string | null
    {
        const point = graph.points[pointId];
        visited[pointId] = 1;
        const live = listLiveEdges(graph, point);
        const children = new Array<GraphPoint>();
        const edgeOf = new Map<number, number>();

        for (const index of live)
        {
            const edge = graph.edges[index];

            if (index === cameFrom)
            {
                continue;
            }

            const child = graph.points[otherEnd(edge, pointId)];

            if (visited[child.id] === 1)
            {
                cycles++;
                continue;
            }

            visited[child.id] = 1;
            children.push(child);
            edgeOf.set(child.id, index);
            paths.push(edge.from === pointId ? edge.path : [...edge.path].reverse());
        }

        const pathOf = new Map<number, Array<Point>>();

        for (const child of children)
        {
            pathOf.set(child.id, paths[paths.length - children.length + children.indexOf(child)]);
        }

        if (children.length === 0)
        {
            const tip: Tip = { id: `t${tips.length + 1}`, x: point.x, y: point.y, parent: parentNodeId, textLine: null, label: null, match: null, source: "traced", age: null };
            tips.push(tip);
            tipIdOf.set(pointId, tip.id);

            return tip.id;
        }

        const node: TreeNode = { id: `n${nodes.length + 1}`, x: point.x, y0: point.y, y1: point.y, attachY: point.y, parent: parentNodeId, children: [], textLine: null, label: null, source: "traced", age: null };
        nodes.push(node);
        nodeIdOf.set(pointId, node.id);
        children.sort(compareChildPoints);

        for (const child of children)
        {
            const childId = visit(child.id, edgeOf.get(child.id) as number, node.id);

            if (childId !== null)
            {
                node.children.push(childId);
                pathToChild.set(childId, pathOf.get(child.id) as Array<Point>);
            }
        }

        return node.id;
    }

    if (rootEnd >= 0)
    {
        const rootPoint = graph.points[rootEnd];
        const stem = listLiveEdges(graph, rootPoint);

        if (stem.length === 1)
        {
            visited[rootEnd] = 1;
            const first = otherEnd(graph.edges[stem[0]], rootEnd);
            visited[first] = 1;
            paths.push(graph.edges[stem[0]].from === rootEnd ? graph.edges[stem[0]].path : [...graph.edges[stem[0]].path].reverse());
            root = visit(first, stem[0], null);

            // A root end whose first point is a tip is a two-point tree: no node at all.
            if (root !== null && !root.startsWith("n"))
            {
                root = null;
            }
        }
    }

    if (cycles > 0)
    {
        issues.push({ severity: "warning", code: "skeleton-cycles", message: `${cycles} cycle(s) in the line art were cut; a box or a frame may be joined to the tree`, subject: null });
    }

    const fans = collapseFans(nodes, tips, pathToChild, Math.max(thickness, 0.4 * glyphHeight), glyphHeight);

    if (fans > 0)
    {
        issues.push({ severity: "info", code: "fans-merged", message: `${fans} branch(es) that run back through their grandparent's junction were moved up to it: a fan of lines from one point thins into successive forks`, subject: null });
    }

    return { result: { nodes, tips, root, issues, usedSegments: new Set(), rejected: [], branches: [] }, skeleton, paths };
}
