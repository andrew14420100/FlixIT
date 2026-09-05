const js = require("@eslint/js");
const tsParser = require("@typescript-eslint/parser");
const globals = require("globals");

module.exports = [
  { ignores: ["build/**", "node_modules/**", "public/**", "craco.config.js"] },
  js.configs.recommended,
  {
    files: ["src/**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module", ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.es2021, process: "readonly", JSX: "readonly", React: "readonly", NodeJS: "readonly" },
    },
    rules: {
      "no-unused-vars": "off",
      "no-undef": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-useless-escape": "off",
      "no-prototype-builtins": "off",
    },
  },
];
