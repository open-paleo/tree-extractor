import type { TesseractLike } from "../ocr/tesseract.ts";

declare global
{
    /**
     * Tesseract.js is loaded from a script tag and attaches itself to the window.
     */
    // Global augmentation can only be declared through interface merging.
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface Window
    {
        /**
         * The Tesseract.js module, if its script loaded.
         */
        Tesseract?: TesseractLike;
    }
}
