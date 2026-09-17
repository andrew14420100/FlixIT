// Flat config for ESLint 9 (CLI/tooling). CRA's dev-server lint is configured in craco.config.js.
const tsParser = require("@typescript-eslint/parser");
const reactHooks = require("eslint-plugin-react-hooks");

module.exports = [
  { ignores: ["build/**", "node_modules/**", "plugins/**", "public/**"] },
  {
    files: ["src/**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
      globals: { window: "readonly", document: "readonly", localStorage: "readonly", fetch: "readonly", console: "readonly", process: "readonly", setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly", clearInterval: "readonly", navigator: "readonly", URL: "readonly", AbortController: "readonly", performance: "readonly", IntersectionObserver: "readonly", HTMLElement: "readonly", Promise: "readonly", requestAnimationFrame: "readonly", cancelAnimationFrame: "readonly", screen: "readonly" },
    },
    plugins: { "react-hooks": reactHooks },
    rules: { "react-hooks/rules-of-hooks": "error" },
  },
];
