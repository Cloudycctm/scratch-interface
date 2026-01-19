import { build } from "bun";

const result = await build({
    entrypoints: ["index.ts"],
    outdir: "./",
    naming: "bundle.js",
    external: ["*.mp3"],
    target: "node",
    sourcemap: "none",
    minify: true,
    format: "esm",
    banner: `import { createRequire } from "node:module";const require = createRequire(import.meta.url);`,
});

console.log(result);
