import { build } from "bun";

const result = await build({
    entrypoints: ["src/index.ts"],
    outdir: "./",
    naming: "bundle.js",
    external: ["*.mp3"],
    target: "browser",
    sourcemap: "none",
    minify: true,
    format: "esm",
    // banner: `import { createRequire } from "node:module";const require = createRequire(import.meta.url);`,
});

console.log(result);
