/**
 * Newick reading and writing.
 */

import type { ExtractionDocument, TreeNode } from "./types.ts";

/**
 * A node of a parsed Newick tree.
 */
export type ParsedNode = {
    /**
     * Label, unquoted, or null.
     */
    label: string | null;

    /**
     * Child nodes; empty for a leaf.
     */
    children: Array<ParsedNode>;

    /**
     * Branch length, or null when absent.
     */
    length: number | null;
};

/**
 * Formats a label for Newick: underscores for spaces when that is enough, otherwise quotes.
 *
 * @param label - Label text.
 * @returns Newick-safe label.
 */
export function formatLabel(label: string): string
{
    const underscored = label.trim().replace(/\s+/g, "_");

    if (/^[A-Za-z0-9_.-]+$/.test(underscored))
    {
        return underscored;
    }

    return `'${label.trim().replace(/'/g, "''")}'`;
}

/**
 * Returns the name to print for a tip: the accepted match, else the OCR label, else the id.
 *
 * @param document - Source document.
 * @param tipId - Tip identifier.
 * @returns Display name.
 */
export function getTipDisplayName(document: ExtractionDocument, tipId: string): string
{
    for (const tip of document.tips)
    {
        if (tip.id !== tipId)
        {
            continue;
        }

        if (tip.match !== null && tip.match.accepted)
        {
            return tip.match.name;
        }

        return tip.label ?? tip.id;
    }

    return tipId;
}

/**
 * Serializes the document's main tree as Newick.
 *
 * @param document - Source document.
 * @returns Newick string with trailing semicolon, or null when there is no tree.
 */
export function formatDocumentAsNewick(document: ExtractionDocument): string | null
{
    if (document.root === null)
    {
        return null;
    }

    const nodeById = new Map<string, TreeNode>();

    for (const node of document.nodes)
    {
        nodeById.set(node.id, node);
    }

    function render(id: string): string
    {
        const node = nodeById.get(id);

        if (node === undefined)
        {
            return formatLabel(getTipDisplayName(document, id));
        }

        const parts = new Array<string>();

        for (const child of node.children)
        {
            parts.push(render(child));
        }

        return `(${parts.join(",")})${node.label === null ? "" : formatLabel(node.label)}`;
    }

    return `${render(document.root)};`;
}

/**
 * Recursive-descent reader for Newick text. Comments in square brackets are skipped.
 */
export class NewickParser
{
    private readonly text: string;

    private position = 0;

    /**
     * Creates a parser over one Newick string.
     *
     * @param text - Newick text, with or without the trailing semicolon.
     */
    public constructor(text: string)
    {
        this.text = text;
    }

    /**
     * Parses the whole string.
     *
     * @returns The root node.
     */
    public parse(): ParsedNode
    {
        const root = this.readNode();
        this.skipTrivia();

        if (this.text[this.position] === ";")
        {
            this.position++;
        }

        this.skipTrivia();

        if (this.position < this.text.length)
        {
            throw new Error(`unexpected text at offset ${this.position}`);
        }

        return root;
    }

    /**
     * Advances past whitespace and bracketed comments.
     */
    private skipTrivia(): void
    {
        for (;;)
        {
            while (this.position < this.text.length && /\s/.test(this.text[this.position]))
            {
                this.position++;
            }

            if (this.text[this.position] !== "[")
            {
                return;
            }

            const close = this.text.indexOf("]", this.position);
            this.position = close < 0 ? this.text.length : close + 1;
        }
    }

    /**
     * Reads a quoted or bare label at the current position.
     *
     * @returns The label, or null when there is none.
     */
    private readLabel(): string | null
    {
        this.skipTrivia();

        if (this.text[this.position] === "'")
        {
            return this.readQuotedLabel();
        }

        const start = this.position;

        while (this.position < this.text.length && !"(),:;[".includes(this.text[this.position]) && !/\s/.test(this.text[this.position]))
        {
            this.position++;
        }

        const raw = this.text.slice(start, this.position);

        return raw.length === 0 ? null : raw.replace(/_/g, " ");
    }

    /**
     * Reads a single-quoted label, where a doubled quote stands for one quote.
     *
     * @returns The label text.
     */
    private readQuotedLabel(): string
    {
        let value = "";
        this.position++;

        while (this.position < this.text.length)
        {
            if (this.text[this.position] === "'" && this.text[this.position + 1] === "'")
            {
                value += "'";
                this.position += 2;
            }
            else if (this.text[this.position] === "'")
            {
                this.position++;
                break;
            }
            else
            {
                value += this.text[this.position];
                this.position++;
            }
        }

        return value;
    }

    /**
     * Reads an optional branch length after a colon.
     *
     * @returns The length, or null when absent.
     */
    private readLength(): number | null
    {
        this.skipTrivia();

        if (this.text[this.position] !== ":")
        {
            return null;
        }

        this.position++;
        this.skipTrivia();
        const start = this.position;

        while (this.position < this.text.length && /[0-9.eE+-]/.test(this.text[this.position]))
        {
            this.position++;
        }

        return Number.parseFloat(this.text.slice(start, this.position));
    }

    /**
     * Reads a subtree: an optional parenthesised child list, then a label and length.
     *
     * @returns The node.
     */
    private readNode(): ParsedNode
    {
        this.skipTrivia();
        const children = new Array<ParsedNode>();

        if (this.text[this.position] === "(")
        {
            this.position++;

            for (;;)
            {
                children.push(this.readNode());
                this.skipTrivia();

                if (this.text[this.position] !== ",")
                {
                    break;
                }

                this.position++;
            }

            this.skipTrivia();

            if (this.text[this.position] !== ")")
            {
                throw new Error(`expected ')' at offset ${this.position}`);
            }

            this.position++;
        }

        const label = this.readLabel();
        const length = this.readLength();

        return { label, children, length };
    }
}

/**
 * Parses a Newick string.
 *
 * @param text - Newick text, with or without the trailing semicolon.
 * @returns The root node.
 */
export function parseNewick(text: string): ParsedNode
{
    return new NewickParser(text).parse();
}

/**
 * Pulls the first tree out of a Nexus TREES block.
 *
 * @param text - Nexus file contents.
 * @returns The tree's Newick string, or null if none is found.
 */
export function extractFirstTreeFromNexus(text: string): string | null
{
    const withoutComments = text.replace(/\[[^\]]*\]/g, "");
    const match = /\btree\s+[^=]+=\s*([^;]+;)/i.exec(withoutComments);

    return match === null ? null : match[1].trim();
}
