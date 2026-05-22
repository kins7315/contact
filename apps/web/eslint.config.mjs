import js from "@eslint/js";
import vueTs from "@vue/eslint-config-typescript";

export default [
  js.configs.recommended,
  ...vueTs(),
  {
    files: ["src/**/*.{ts,vue}"],
    rules: {}
  }
];
