/**
 * The viewer as a custom element. The element mounts the viewer when it joins a page and
 * removes it when it leaves, so a host need only write the tag. Locations are attributes;
 * the two options that are not text, the Tesseract.js loader and a list of known names, are
 * properties, and may be set before or after the element is defined or connected.
 *
 *     <tree-extractor worker-url="/assets/worker.js" known-names-url="/data/taxa.txt"></tree-extractor>
 *
 * Importing this module defines nothing; call defineTreeExtractorElement.
 */

import type { ExtractionDocument } from "../core/types.ts";
import type { TesseractLike, TesseractPaths } from "../ocr/tesseract.ts";
import type { TreeExtractorHandle, TreeExtractorOptions } from "./viewer.ts";
import { mountTreeExtractor } from "./viewer.ts";

/**
 * Loads the Tesseract.js module.
 */
export type TesseractLoader = () => TesseractLike | Promise<TesseractLike>;

/**
 * The tree extractor viewer as an element.
 */
export class TreeExtractorElement extends HTMLElement
{
    /**
     * Attributes whose change the element acts on.
     */
    public static readonly observedAttributes = ["image"];

    private handle: TreeExtractorHandle | null = null;

    private loader: TesseractLoader | null = null;

    private names: Array<string> | null = null;

    private clades: Array<string> | null = null;

    /**
     * The Tesseract.js loader; without one the viewer traces trees but reads no labels.
     *
     * @returns The loader, or null.
     */
    public get loadTesseract(): TesseractLoader | null
    {
        return this.loader;
    }

    /**
     * Sets the Tesseract.js loader. It is first called when an extraction reads labels, so it
     * may be set after the element is on the page.
     */
    public set loadTesseract(loader: TesseractLoader | null)
    {
        this.loader = loader;
    }

    /**
     * Known taxon names for the second tier of matching, when given as a list.
     *
     * @returns The names, or null.
     */
    public get knownNames(): Array<string> | null
    {
        return this.names;
    }

    /**
     * Sets the known taxon names; takes effect at once on a mounted viewer.
     */
    public set knownNames(names: Array<string> | null)
    {
        this.names = names;

        if (this.handle !== null && names !== null)
        {
            this.handle.setKnownNames(names);
        }
    }

    /**
     * Known clades, when given as a list.
     *
     * @returns The clade names, or null.
     */
    public get knownClades(): Array<string> | null
    {
        return this.clades;
    }

    /**
     * Sets the known clades; takes effect at once on a mounted viewer.
     */
    public set knownClades(names: Array<string> | null)
    {
        this.clades = names;

        if (this.handle !== null && names !== null)
        {
            this.handle.setKnownClades(names);
        }
    }

    /**
     * Mounts the viewer.
     */
    public connectedCallback(): void
    {
        // A property set on the element before it was defined sits on the instance and hides
        // the accessor; it is taken off and set again through the accessor.
        this.adoptProperty("loadTesseract");
        this.adoptProperty("knownNames");
        this.adoptProperty("knownClades");
        const workerUrl = this.getAttribute("worker-url");

        if (workerUrl === null)
        {
            throw new Error("tree-extractor needs a worker-url attribute");
        }

        const paths: TesseractPaths = {};
        const workerPath = this.getAttribute("tesseract-worker-path");
        const corePath = this.getAttribute("tesseract-core-path");
        const langPath = this.getAttribute("tesseract-lang-path");

        if (workerPath !== null)
        {
            paths.workerPath = workerPath;
        }

        if (corePath !== null)
        {
            paths.corePath = corePath;
        }

        if (langPath !== null)
        {
            paths.langPath = langPath;
        }

        const options: TreeExtractorOptions = {
            workerUrl,
            loadTesseract: this.callLoader.bind(this),
            tesseractPaths: workerPath === null && corePath === null && langPath === null ? undefined : paths,
            knownNames: this.names ?? this.getAttribute("known-names-url") ?? undefined,
            knownClades: this.clades ?? this.getAttribute("known-clades-url") ?? undefined,
            image: this.getAttribute("image") ?? undefined,
        };
        this.handle = mountTreeExtractor(this, options);
    }

    /**
     * Removes the viewer.
     */
    public disconnectedCallback(): void
    {
        if (this.handle !== null)
        {
            this.handle.destroy();
            this.handle = null;
        }
    }

    /**
     * Loads a new image when the image attribute changes on a mounted viewer.
     *
     * @param name - Attribute name.
     * @param previous - Value before.
     * @param value - Value now.
     */
    public attributeChangedCallback(name: string, previous: string | null, value: string | null): void
    {
        if (name === "image" && this.handle !== null && value !== null && value !== previous)
        {
            void this.handle.loadImage(value);
        }
    }

    /**
     * The tree as Newick with the user's edits.
     *
     * @returns Newick text, or null before an extraction or when unmounted.
     */
    public getNewick(): string | null
    {
        return this.handle === null ? null : this.handle.getNewick();
    }

    /**
     * The extraction document with the user's edits.
     *
     * @returns The document, or null before an extraction or when unmounted.
     */
    public getDocument(): ExtractionDocument | null
    {
        return this.handle === null ? null : this.handle.getDocument();
    }

    /**
     * Calls the loader the host set, at the time labels are first read.
     *
     * @returns The Tesseract.js module.
     */
    private callLoader(): TesseractLike | Promise<TesseractLike>
    {
        if (this.loader === null)
        {
            throw new Error("no Tesseract.js loader was set on the tree-extractor element");
        }

        return this.loader();
    }

    /**
     * Moves a property set before the element was defined onto its accessor.
     *
     * @param name - Property name.
     */
    private adoptProperty(name: "loadTesseract" | "knownNames" | "knownClades"): void
    {
        if (Object.prototype.hasOwnProperty.call(this, name))
        {
            const record = this as unknown as Record<string, unknown>;
            const value = record[name];
            delete record[name];
            record[name] = value;
        }
    }
}

/**
 * Defines the element under a tag name, once.
 *
 * @param tagName - Tag to define; tree-extractor by default.
 */
export function defineTreeExtractorElement(tagName = "tree-extractor"): void
{
    if (customElements.get(tagName) === undefined)
    {
        customElements.define(tagName, TreeExtractorElement);
    }
}
