import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/v2/index.ts", "src/v3/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ["effect"],
});
