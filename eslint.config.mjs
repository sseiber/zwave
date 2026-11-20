import { defineConfig } from 'eslint/config';
import jseslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import stylisticPlugin from '@stylistic/eslint-plugin';
import unicornPlugin from 'eslint-plugin-unicorn';
import globals from 'globals';

const stylisticRules = {
    '@stylistic/arrow-parens': ['error', 'as-needed', { requireForBlockBody: true }],
    '@stylistic/brace-style': ['error', 'stroustrup'],
    '@stylistic/comma-dangle': 'error',
    '@stylistic/eol-last': 'error',
    '@stylistic/member-delimiter-style': 'error',
    '@stylistic/new-parens': 'error',
    '@stylistic/no-multiple-empty-lines': 'error',
    // Added during the eslint 10 migration: unicorn/prefer-export-from's autofix
    // rewrote the utils barrel as `export {exMessage}`, which lint had no opinion
    // about and the rest of the codebase does not match
    '@stylistic/object-curly-spacing': ['error', 'always'],
    '@stylistic/quotes': ['error', 'single', { allowTemplateLiterals: 'always' }],
    '@stylistic/quote-props': ['error', 'as-needed', { 'unnecessary': false }],
    '@stylistic/semi': ['error', 'always'],
    '@stylistic/spaced-comment': ['error', 'always', { exceptions: ['-+'] }],
    '@stylistic/type-annotation-spacing': 'error'
};

const typescriptRules = {
    'curly': 'error',
    'eqeqeq': ['error', 'always'],
    '@typescript-eslint/explicit-function-return-type': ['error', { allowFunctionsWithoutTypeParameters: true }],
    '@typescript-eslint/explicit-member-accessibility': ['error', { accessibility: 'explicit', overrides: { constructors: 'no-public' } }],
    '@typescript-eslint/explicit-module-boundary-types': ['error', { allowArgumentsExplicitlyTypedAsAny: true }],
    'guard-for-in': 'error',
    'no-caller': 'error',
    'no-duplicate-imports': 'error',
    'no-eval': 'error',
    'no-extra-bind': 'error',
    'no-console': 'error',
    '@typescript-eslint/no-explicit-any': ['off', { ignoreRestArgs: true }],
    'no-new-func': 'error',
    'no-new-wrappers': 'error',
    'no-sequences': 'error',
    'no-template-curly-in-string': 'error',
    'no-throw-literal': 'error',
    'no-undef-init': 'error',
    'no-underscore-dangle': ['error', { allowAfterThis: true, allowFunctionParams: true }],
    'no-unneeded-ternary': 'error',
    '@typescript-eslint/no-unsafe-assignment': 'off',
    '@typescript-eslint/no-unsafe-call': 'off',
    '@typescript-eslint/no-unsafe-enum-comparison': 'off',
    '@typescript-eslint/no-unsafe-member-access': 'off',
    '@typescript-eslint/no-unsafe-argument': 'off',
    '@typescript-eslint/no-unsafe-return': 'off',
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { args: 'all', argsIgnorePattern: '^_', caughtErrors: 'all', caughtErrorsIgnorePattern: '^_' }],
    'object-shorthand': 'error',
    'prefer-object-spread': 'error',
    'prefer-template': 'error',
    '@typescript-eslint/prefer-promise-reject-errors': ['error', { allowThrowingAny: true, allowThrowingUnknown: true }],
    '@typescript-eslint/promise-function-async': 'error',
    'radix': 'error',
    'require-await': 'off',
    '@typescript-eslint/require-await': 'error',
    '@typescript-eslint/unified-signatures': 'error'
};

const javascriptRules = {
};

// Carried over from loopbox-monorepo. The 'off' entries are the ones whose advice is
// either a matter of taste or actively worse in this codebase -- noted individually
// rather than switching off whole categories.
const unicornRules = {
    'unicorn/filename-case': [
        'error',
        {
            cases: {
                camelCase: true,
                pascalCase: true
            },
            checkDirectories: false
        }
    ],
    'unicorn/catch-error-name': 'off',
    'unicorn/consistent-boolean-name': 'off',
    'unicorn/consistent-conditional-object-spread': ['error', 'ternary'],
    'unicorn/name-replacements': 'off',
    // Iterator#toArray() is an ES2025 iterator helper; this project compiles to ES2024
    'unicorn/prefer-iterator-to-array': 'off',
    // Node-style callbacks take null for "no error" -- Fastify's content type parser
    // is called as done(null, body), and undefined is not the same signal
    'unicorn/no-null': 'off',
    // index.ts is the process entry point, and this service fails fast by design when
    // the Z-Wave driver cannot start
    'unicorn/no-process-exit': 'off',
    // Public API first, private helpers after. The rule's default puts private
    // methods ahead of public ones, which would hoist ~20 of zwaveController's
    // internals above init() and bury its REST surface at the bottom of the file.
    // Flipping those two groups asks for the order these classes already use, and
    // only sorts by group -- members keep their relative order within one.
    'unicorn/consistent-class-member-order': ['error', {
        order: [
            'static-field',
            'static-block',
            'static-method',
            'private-field',
            'public-field',
            'constructor',
            'public-method',
            'private-method'
        ]
    }],
    'unicorn/no-break-in-nested-loop': 'off',
    'unicorn/no-duplicate-loops': 'off',
    'unicorn/no-unreadable-for-of-expression': 'off',
    'unicorn/prefer-simple-condition-first': 'off',
    'unicorn/prefer-smaller-scope': 'off',
    'unicorn/prefer-ternary': 'off',
    'unicorn/require-array-sort-compare': 'off'
};


export default defineConfig(
    {
        ignores: [
            'resources',
            '**/dist',
            'storage',
            'thunder-tests',
            'packages/web/**'
        ]
    },
    {
        files: [
            'packages/service/src/**/*.ts',
            'packages/contracts/src/**/*.ts'
        ],
        extends: [
            jseslint.configs.recommended,
            ...tseslint.configs.recommendedTypeChecked,
            ...tseslint.configs.stylisticTypeChecked,
            stylisticPlugin.configs['disable-legacy'],
            unicornPlugin.configs.recommended
        ],
        languageOptions: {
            globals: {
                NodeJS: true,
                ...globals.node
            },
            parser: tseslint.parser,
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname
            }
        },
        plugins: {
            '@typescript-eslint': tseslint.plugin,
            '@stylistic': stylisticPlugin
        },
        rules: {
            ...typescriptRules,
            ...stylisticRules,
            ...unicornRules
        }
    },
    {
        files: [
            'eslint.config.mjs'
        ],
        extends: [
            jseslint.configs.recommended,
            ...tseslint.configs.recommended,
            ...tseslint.configs.stylistic,
            stylisticPlugin.configs['disable-legacy']
        ],
        plugins: {
            '@typescript-eslint': tseslint.plugin,
            '@stylistic': stylisticPlugin
        },
        rules: {
            ...javascriptRules,
            ...stylisticRules
        }
    }
);
