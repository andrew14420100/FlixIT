// Root ESLint flat config: reuse the frontend configuration for tooling that lints from /app.
const frontendConfig = require("./frontend/eslint.config.js");

module.exports = [
  { ignores: ["**/node_modules/**", "frontend/build/**", "frontend/plugins/**", "frontend/public/**", "omni-runtime/**", "provider-runtime/**", "backend/**", "logs/**"] },
  ...frontendConfig.map((entry) =>
    entry.files ? { ...entry, files: entry.files.map((pattern) => `frontend/${pattern}`) } : entry
  ),
];
