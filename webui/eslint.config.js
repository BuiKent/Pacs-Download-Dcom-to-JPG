import globals from "globals";

export default [
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      "no-undef": "error",
      // An unused parameter or caught error is often forced by a signature, so
      // "_" marks those as deliberate. An unused *variable or function* is not
      // forced by anything: renaming it to "_withAlpha" only hides dead code
      // from the gate, which is what happened to `withAlpha` and to an
      // exported `getMprPrimaryPlane` that existed solely to give a write-only
      // variable a reader. There is no escape hatch here on purpose — delete
      // it instead.
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // The marker-strip crash was NOT an undeclared variable, so `no-undef`
      // would never have seen it: `series` was declared further down the same
      // block, and the handler that read it was invoked synchronously above
      // that line — a temporal-dead-zone throw. `functions: false` keeps the
      // hoisted-function style this file is written in legal.
      "no-use-before-define": [
        "error",
        { functions: false, classes: true, variables: true },
      ],
      "no-const-assign": "error",
      "no-dupe-keys": "error",
      "no-unreachable": "error",
      "no-duplicate-imports": "error",
    },
  },
  {
    files: ["src/**/*.test.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        vi: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
      },
    },
  },
];
