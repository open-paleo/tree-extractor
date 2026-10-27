/**
 * Nexus writing.
 */

import { formatLabel } from "./newick.ts";

/**
 * Wraps a Newick tree in a Nexus file with TAXA and TREES blocks.
 *
 * @param newick - Newick string with trailing semicolon.
 * @param taxa - Tip names in the order they should be listed.
 * @param treeName - Name for the TREE statement.
 * @param comment - Optional comment placed after the header.
 * @returns Nexus file contents.
 */
export function formatNexus(newick: string, taxa: Array<string>, treeName: string, comment: string | null): string
{
    const lines = ["#NEXUS", ""];

    if (comment !== null)
    {
        lines.push(`[ ${comment.replace(/\]/g, ")")} ]`, "");
    }

    lines.push("BEGIN TAXA;");
    lines.push(`    DIMENSIONS NTAX=${taxa.length};`);
    lines.push("    TAXLABELS");

    for (const taxon of taxa)
    {
        lines.push(`        ${formatLabel(taxon)}`);
    }

    lines.push("    ;");
    lines.push("END;");
    lines.push("");
    lines.push("BEGIN TREES;");
    lines.push(`    TREE ${treeName} = [&R] ${newick}`);
    lines.push("END;");
    lines.push("");

    return lines.join("\n");
}
