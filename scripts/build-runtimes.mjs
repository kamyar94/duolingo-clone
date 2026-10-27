// Puts the browser runtimes of the coding lessons into public/runtimes, where the app serves them
// itself (docs/DESIGN-coding-and-math.md, section 4.4): Pyodide and sql.js from their npm
// packages, the TypeScript compiler and its library files, the Jedi and parso wheels for Python
// completion (downloaded from PyPI and checked against pinned hashes), and the runner scripts
// of lib/coding/workers bundled with esbuild. The folder is generated, never committed.
//
// Runs before `next dev` and `next build` (package.json) and in the Dockerfile.
//   node scripts/build-runtimes.mjs           copy and bundle
//   node scripts/build-runtimes.mjs --check   only report whether the folder is complete
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "public", "runtimes");
const modules = path.join(root, "node_modules");
const cache = path.join(modules, ".cache", "lingo-runtimes");

// Pure-Python wheels for completion (Jedi inside Pyodide). Versions follow the Pyodide lock file
// of the pinned Pyodide release; hashes are PyPI's.
const WHEELS = [
  {
    file: "parso-0.8.6-py2.py3-none-any.whl",
    url: "https://files.pythonhosted.org/packages/b6/61/fae042894f4296ec49e3f193aff5d7c18440da9e48102c3315e1bc4519a7/parso-0.8.6-py2.py3-none-any.whl",
    sha256: "2c549f800b70a5c4952197248825584cb00f033b29c692671d3bf08bf380baff",
  },
  {
    file: "jedi-0.19.2-py2.py3-none-any.whl",
    url: "https://files.pythonhosted.org/packages/c0/5a/9cac0c82afec3d09ccd97c8b6502d48f165f9124db81b4bcb90b4af974ee/jedi-0.19.2-py2.py3-none-any.whl",
    sha256: "a8ef22bde8490f57fe5c7681a3c83cb58874daf72b4784de3cce5b6ef6edb5b9",
  },
];

const COPIES = [
  {
    from: "pyodide",
    to: "pyodide",
    files: [
      "pyodide.mjs",
      "pyodide.asm.mjs",
      "pyodide.asm.wasm",
      "python_stdlib.zip",
      "pyodide-lock.json",
    ],
  },
  { from: "sql.js/dist", to: "sqljs", files: ["sql-wasm.js", "sql-wasm.wasm"] },
  { from: "typescript/lib", to: "typescript", files: ["typescript.js"] },
];

const WORKERS = [
  { entry: "frame", format: "iife" },
  { entry: "python-worker", format: "iife" },
  { entry: "sql-worker", format: "iife" },
  { entry: "ts-service", format: "iife" },
];

const version = async (name) =>
  JSON.parse(await readFile(path.join(modules, name, "package.json"), "utf8")).version;

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

const fetchWheel = async ({ file, url, sha256: expected }) => {
  const cached = path.join(cache, file);
  if (existsSync(cached) && sha256(await readFile(cached)) === expected) return cached;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (sha256(buffer) !== expected) throw new Error(`${file}: hash mismatch`);
  await mkdir(cache, { recursive: true });
  await writeFile(cached, buffer);
  return cached;
};

const check = async () => {
  const missing = [
    ...COPIES.flatMap(({ to, files }) => files.map((file) => path.join(to, file))),
    ...WORKERS.map(({ entry }) => path.join("lingo", `${entry}.js`)),
    path.join("python", "wheels.json"),
  ].filter((file) => !existsSync(path.join(out, file)));
  if (missing.length) {
    console.error(`public/runtimes is incomplete: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log("public/runtimes is complete.");
};

const main = async () => {
  await rm(out, { recursive: true, force: true });

  for (const { from, to, files } of COPIES) {
    await mkdir(path.join(out, to), { recursive: true });
    for (const file of files)
      await copyFile(path.join(modules, from, file), path.join(out, to, file));
  }

  const tsLib = path.join(modules, "typescript", "lib");
  await mkdir(path.join(out, "typescript", "lib"), { recursive: true });
  for (const file of await readdir(tsLib))
    if (/^lib\..*\.d\.ts$/.test(file))
      await copyFile(path.join(tsLib, file), path.join(out, "typescript", "lib", file));

  await mkdir(path.join(out, "python"), { recursive: true });
  const wheels = [];
  for (const wheel of WHEELS) {
    try {
      await copyFile(await fetchWheel(wheel), path.join(out, "python", wheel.file));
      wheels.push(wheel.file);
    } catch (error) {
      console.warn(`Python completion stays at keywords: ${error.message}`);
    }
  }
  await writeFile(
    path.join(out, "python", "wheels.json"),
    JSON.stringify(wheels.length === WHEELS.length ? wheels : [])
  );

  for (const { entry, format } of WORKERS)
    await build({
      entryPoints: [path.join(root, "lib", "coding", "workers", `${entry}.ts`)],
      outfile: path.join(out, "lingo", `${entry}.js`),
      bundle: true,
      format,
      platform: "browser",
      target: "es2020",
      minify: true,
      legalComments: "none",
      logLevel: "warning",
    });

  const versions = {
    pyodide: await version("pyodide"),
    "sql.js": await version("sql.js"),
    typescript: await version("typescript"),
    wheels,
  };
  await writeFile(path.join(out, "versions.json"), JSON.stringify(versions, null, 2));
  console.log(`public/runtimes ready: ${JSON.stringify(versions)}`);
};

await (process.argv.includes("--check") ? check() : main());
