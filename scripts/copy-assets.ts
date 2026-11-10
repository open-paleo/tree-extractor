/**
 * Copies the files the build does not compile into dist: the viewer's stylesheet.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..");
fs.mkdirSync(path.join(root, "dist", "web"), { recursive: true });
fs.copyFileSync(path.join(root, "src", "web", "styles.css"), path.join(root, "dist", "web", "styles.css"));
