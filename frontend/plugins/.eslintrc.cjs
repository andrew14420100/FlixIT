// ESLint flat config used by the platform pre-completion linter (mirrors ../eslint.config.js)
const js = require("@eslint/js");
const tsParser = require("@typescript-eslint/parser");
const globals = require("globals");

module.exports = [
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module", ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node, ...globals.es2021, JSX: "readonly", React: "readonly", NodeJS: "readonly" },
    },
    rules: {
      "no-unused-vars": "off",
      "no-undef": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-useless-escape": "off",
      "no-prototype-builtins": "off",
      "no-constant-condition": "off",
      "no-dupe-keys": "off",
    },
  },
];
