import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import stylistic from "@stylistic/eslint-plugin";

// Formatting rules mirroring the open-paleo/data and open-paleo/web repositories so all three
// read the same way.
const sharedStylisticRules = {
    "@stylistic/brace-style": ["error", "allman", { allowSingleLine: false }],
    "@stylistic/indent": ["error", 4],
    "@stylistic/no-tabs": "error",
    "@stylistic/quotes": ["error", "double", { avoidEscape: true }],
    "@stylistic/semi": ["error", "always"],
    "@stylistic/comma-dangle": ["error", "always-multiline"],
    "@stylistic/comma-spacing": "error",
    "@stylistic/key-spacing": "error",
    "@stylistic/keyword-spacing": "error",
    "@stylistic/space-before-blocks": "error",
    "@stylistic/space-infix-ops": "error",
    "@stylistic/object-curly-spacing": ["error", "always"],
    "@stylistic/arrow-spacing": "error",
    "@stylistic/block-spacing": "error",
    "@stylistic/semi-spacing": "error",
    "@stylistic/space-before-function-paren": ["error", {
        anonymous: "always",
        named: "never",
        asyncArrow: "always",
    }],
    "@stylistic/no-trailing-spaces": "error",
    "@stylistic/eol-last": ["error", "always"],
    "@stylistic/no-multiple-empty-lines": ["error", { max: 1, maxEOF: 0, maxBOF: 0 }],
    "@stylistic/padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: "block-like", next: "*" },
        { blankLine: "always", prev: "*", next: "return" },
    ],
    "prefer-const": "error",
    "no-var": "error",
};

export default tseslint.config(
    eslint.configs.recommended,
    {
        files: ["**/*.ts"],
        extends: [...tseslint.configs.recommended],
        plugins: {
            "@stylistic": stylistic,
        },
        rules: {
            ...sharedStylisticRules,
            "no-restricted-imports": ["error", {
                paths: [
                    { name: "fs", message: "Use 'node:fs' instead." },
                    { name: "fs/promises", message: "Use 'node:fs/promises' instead." },
                    { name: "path", message: "Use 'node:path' instead." },
                    { name: "url", message: "Use 'node:url' instead." },
                    { name: "os", message: "Use 'node:os' instead." },
                    { name: "http", message: "Use 'node:http' instead." },
                ],
            }],
            camelcase: "off",
            "no-underscore-dangle": "off",
            "@typescript-eslint/naming-convention": ["error",
                {
                    selector: "default",
                    format: ["camelCase"],
                    leadingUnderscore: "forbid",
                    trailingUnderscore: "forbid",
                },
                {
                    selector: "typeLike",
                    format: ["PascalCase"],
                },
                {
                    selector: "parameter",
                    modifiers: ["unused"],
                    format: ["camelCase"],
                    leadingUnderscore: "allow",
                    filter: { regex: "^_$", match: true },
                },
                {
                    selector: "objectLiteralProperty",
                    format: null,
                },
                {
                    selector: "typeProperty",
                    format: null,
                },
            ],
            "@typescript-eslint/no-unused-vars": ["error", {
                argsIgnorePattern: "^_$",
            }],
            "@typescript-eslint/no-explicit-any": "error",
            "@typescript-eslint/consistent-type-definitions": ["error", "type"],
            "@typescript-eslint/array-type": ["error", { default: "generic" }],
        },
    },
    {
        ignores: ["dist/**", "node_modules/**", "bench/out/**"],
    },
);
