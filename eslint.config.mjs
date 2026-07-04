import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    ".claude/**",
    "build/**",
    "next-env.d.ts",
    "**/*.md",
    "**/*.md",
    "**/*.mdx",
  ]),
]);

export default eslintConfig;
