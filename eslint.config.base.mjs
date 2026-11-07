// Cau hinh ESLint phang (flat) dung chung cho cac goi Node cua AutoTest.
// Moi goi tao eslint.config.mjs rieng va import { baseLintConfig } tu file nay.
import tseslint from "typescript-eslint";

export const baseLintConfig = [
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];
