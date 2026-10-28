/**
 * Downloads of the extracted tree in each format.
 */

import type { ExtractionDocument } from "../core/types.ts";
import { formatDocumentAsNewick, getTipDisplayName } from "../core/newick.ts";
import { formatNexus } from "../core/nexus.ts";
import { renderTreeSvg } from "../core/render.ts";

/**
 * Offers a text file for download.
 *
 * @param name - File name.
 * @param text - File contents.
 * @param type - Media type.
 */
function downloadText(name: string, text: string, type: string): void
{
    const url = URL.createObjectURL(new Blob([text], { type }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
}

/**
 * Downloads the tree as Newick.
 *
 * @param extraction - Document with a tree.
 * @param fileStem - File name without extension.
 */
export function downloadNewickFile(extraction: ExtractionDocument, fileStem: string): void
{
    downloadText(`${fileStem}.nwk`, `${formatDocumentAsNewick(extraction) ?? ""}\n`, "text/plain");
}

/**
 * Downloads the tree as Nexus.
 *
 * @param extraction - Document with a tree.
 * @param fileStem - File name without extension.
 */
export function downloadNexusFile(extraction: ExtractionDocument, fileStem: string): void
{
    const newick = formatDocumentAsNewick(extraction);

    if (newick === null)
    {
        return;
    }

    const taxa = new Array<string>();

    for (const tip of extraction.tips)
    {
        if (tip.parent !== null)
        {
            taxa.push(getTipDisplayName(extraction, tip.id));
        }
    }

    downloadText(`${fileStem}.nex`, formatNexus(newick, taxa, "extracted", `Extracted from ${fileStem} by tree-extractor`), "text/plain");
}

/**
 * Downloads the extraction document as JSON.
 *
 * @param extraction - Document.
 * @param fileStem - File name without extension.
 */
export function downloadDocumentFile(extraction: ExtractionDocument, fileStem: string): void
{
    downloadText(`${fileStem}.json`, JSON.stringify(extraction, null, 2), "application/json");
}

/**
 * Downloads the redrawn tree as SVG.
 *
 * @param extraction - Document with a tree.
 * @param fileStem - File name without extension.
 */
export function downloadSvgFile(extraction: ExtractionDocument, fileStem: string): void
{
    const svg = renderTreeSvg(extraction);

    if (svg !== null)
    {
        downloadText(`${fileStem}.svg`, `${svg}\n`, "image/svg+xml");
    }
}
