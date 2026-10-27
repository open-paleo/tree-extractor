/**
 * Minimal static server for the browser viewer: serves the repository root so the page at
 * /src/web/ can load the compiled core from /dist/.
 */

import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import * as url from "node:url";

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT ?? 8787);
const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".wasm": "application/wasm",
};

http.createServer((request, response) =>
{
    const requested = decodeURIComponent((request.url ?? "/").split("?")[0]);
    let filePath = path.normalize(path.join(root, requested));

    if (!filePath.startsWith(root))
    {
        response.writeHead(403).end();

        return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory())
    {
        filePath = path.join(filePath, "index.html");
    }

    if (!fs.existsSync(filePath))
    {
        response.writeHead(404).end("not found");

        return;
    }

    response.writeHead(200, { "content-type": types[path.extname(filePath)] ?? "application/octet-stream" });
    fs.createReadStream(filePath).pipe(response);
}).listen(port, () =>
{
    console.log(`viewer: http://localhost:${port}/src/web/`);
});
