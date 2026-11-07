/**
 * Drives the built viewer in a headless browser through one editing session: load a figure,
 * extract it without OCR, delete a tip, undo and redo, edit a label, move a tip by dragging
 * it onto another node, and undo that too. Fails on the first step whose outcome is not what a
 * user would see. Serves the repository itself on a free port for the duration.
 *
 * Run with `npm run test:web` after `npm run build:web`; needs a Chromium that Playwright
 * has installed (`npx playwright install chromium`).
 */

import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import * as url from "node:url";
import { chromium } from "playwright";
import type { Page } from "playwright";

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const figure = path.join(root, "bench", "cases", "fowler2020a_fig9", "figure.png");
const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".png": "image/png",
    ".wasm": "application/wasm",
};

/**
 * Serves the repository on a free port.
 *
 * @returns The server and its port.
 */
function serve(): Promise<{ server: http.Server; port: number }>
{
    return new Promise((resolve) =>
    {
        const server = http.createServer((request, response) =>
        {
            const requested = decodeURIComponent((request.url ?? "/").split("?")[0]);
            let filePath = path.normalize(path.join(root, requested));

            if (!filePath.startsWith(root) || !fs.existsSync(filePath))
            {
                response.writeHead(404).end();

                return;
            }

            if (fs.statSync(filePath).isDirectory())
            {
                filePath = path.join(filePath, "index.html");
            }

            response.writeHead(200, { "content-type": types[path.extname(filePath)] ?? "application/octet-stream" });
            fs.createReadStream(filePath).pipe(response);
        });
        server.listen(0, () =>
        {
            const address = server.address();
            resolve({ server, port: typeof address === "object" && address !== null ? address.port : 0 });
        });
    });
}

/**
 * Fails the run when a condition does not hold.
 *
 * @param condition - What must be true.
 * @param message - What went wrong when it is not.
 */
function expect(condition: boolean, message: string): void
{
    if (!condition)
    {
        throw new Error(message);
    }

    console.log(`ok: ${message}`);
}

/**
 * A point on the screen.
 */
type ScreenPoint = {
    x: number;
    y: number;
};

/**
 * Finds the screen positions of dots of one color drawn on the canvas.
 *
 * @param page - The page.
 * @param color - Dot color.
 * @param tolerance - Per-channel tolerance.
 * @returns Cluster centers in page coordinates.
 */
function findDots(page: Page, color: [number, number, number], tolerance: number): Promise<Array<ScreenPoint>>
{
    return page.evaluate(([wanted, slack]) =>
    {
        const canvas = document.querySelector("canvas") as HTMLCanvasElement;
        const context = canvas.getContext("2d") as CanvasRenderingContext2D;
        const { width, height } = canvas;
        const data = context.getImageData(0, 0, width, height).data;
        const rect = canvas.getBoundingClientRect();
        const clusters: Array<{ x: number; y: number; n: number }> = [];

        for (let y = 0; y < height; y += 2)
        {
            for (let x = 0; x < width; x += 2)
            {
                const index = (y * width + x) * 4;

                if (Math.abs(data[index] - wanted[0]) > slack || Math.abs(data[index + 1] - wanted[1]) > slack || Math.abs(data[index + 2] - wanted[2]) > slack)
                {
                    continue;
                }

                let found: { x: number; y: number; n: number } | null = null;

                for (const cluster of clusters)
                {
                    if (Math.hypot(cluster.x - x, cluster.y - y) < 12)
                    {
                        found = cluster;
                        break;
                    }
                }

                if (found === null)
                {
                    clusters.push({ x, y, n: 1 });
                }
                else
                {
                    found.x = (found.x * found.n + x) / (found.n + 1);
                    found.y = (found.y * found.n + y) / (found.n + 1);
                    found.n++;
                }
            }
        }

        return clusters.filter((cluster) => cluster.n >= 3).map((cluster) => ({ x: cluster.x * rect.width / width + rect.left, y: cluster.y * rect.height / height + rect.top }));
    }, [color, tolerance] as [typeof color, number]);
}

const { server, port } = await serve();
const browser = await chromium.launch();

try
{
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
    const errors = new Array<string>();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://localhost:${port}/src/web/`);
    await page.setInputFiles("#file", figure);
    await page.waitForFunction(() => !(document.querySelector("#run") as HTMLButtonElement).disabled, null, { timeout: 30000 });
    await page.uncheck("#ocr");
    await page.click("#run");
    await page.waitForFunction(() => (document.querySelector("#newick") as HTMLTextAreaElement).value.length > 10, null, { timeout: 120000 });
    const original = await page.inputValue("#newick");
    expect(original.startsWith("(") && original.endsWith(";"), "extraction produced a Newick tree");
    expect(Number((await page.textContent("#tips-count")) ?? "0") > 20 || (await page.locator("#tips li").count()) > 20, "more than twenty tips were listed");

    // Delete, undo, redo.
    await page.click("#tips li[data-id=\"t3\"] span.id");
    await page.click("#delete");
    const afterDelete = await page.inputValue("#newick");
    expect(afterDelete !== original, "deleting a tip changed the tree");
    await page.click("#undo");
    expect((await page.inputValue("#newick")) === original, "undo restored the tree");
    await page.click("#redo");
    expect((await page.inputValue("#newick")) === afterDelete, "redo removed the tip again");
    await page.keyboard.press("Control+z");
    expect((await page.inputValue("#newick")) === original, "the keyboard shortcut undid it");

    // Label edit, undone in one step.
    const input = page.locator("#tips li[data-id=\"t1\"] input");
    await input.fill("Edited name");
    await input.press("X");
    expect((await page.inputValue("#newick")).includes("Edited_nameX"), "a typed label reached the tree");
    await page.click("#tips");
    await page.click("#undo");
    expect((await page.inputValue("#newick")) === original, "one undo reverted the whole label edit");

    // Move a tip by dragging its selection ring onto the farthest node in view.
    await page.click("#move");
    await page.click("#actual");
    await page.click("#tips li[data-id=\"t5\"] span.id");
    await page.waitForTimeout(200);
    const rings = await findDots(page, [255, 200, 0], 40);
    const nodes = await findDots(page, [255, 80, 0], 30);
    expect(rings.length > 0 && nodes.length > 0, "the selected tip's ring and some node dots are on screen");
    let ring = rings[0];

    for (const candidate of rings)
    {
        if (candidate.x < ring.x)
        {
            ring = candidate;
        }
    }

    let node = nodes[0];

    for (const candidate of nodes)
    {
        if (Math.hypot(candidate.x - ring.x, candidate.y - ring.y) > Math.hypot(node.x - ring.x, node.y - ring.y))
        {
            node = candidate;
        }
    }

    await page.mouse.move(ring.x, ring.y);
    await page.mouse.down();

    for (let step = 1; step <= 20; step++)
    {
        await page.mouse.move(ring.x + (node.x - ring.x) * step / 20, ring.y + (node.y - ring.y) * step / 20);
    }

    await page.mouse.up();
    await page.waitForTimeout(200);
    expect(((await page.textContent("#status")) ?? "").startsWith("moved t5 under"), "dropping the tip on a node moved it");
    expect((await page.inputValue("#newick")) !== original, "the move changed the tree");
    await page.click("#undo");
    expect((await page.inputValue("#newick")) === original, "undo reverted the move");
    expect(errors.length === 0, `no page errors (${errors.join("; ")})`);
}
finally
{
    await browser.close();
    server.close();
}
