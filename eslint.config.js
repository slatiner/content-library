import js from '@eslint/js';
import vue from 'eslint-plugin-vue';
import globals from 'globals';

export default [
  { ignores: ['dist/', 'node_modules/', 'supabase/'] },
  js.configs.recommended,
  ...vue.configs['flat/essential'],
  { languageOptions: { globals: { ...globals.browser } } },
  { files: ['scripts/**', 'assets/**/*.mjs', '*.config.js'], languageOptions: { globals: { ...globals.node } } },
  // Single-word component names (Modal, Stars, Avatar) are fine in a small app.
  { rules: { 'vue/multi-word-component-names': 'off' } },
];
