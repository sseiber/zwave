import jseslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import stylisticPlugin from '@stylistic/eslint-plugin';
import globals from 'globals';

const stylisticRules = {
    '@stylistic/arrow-parens': ['error', 'as-needed', { requireForBlockBody: true }],
    '@stylistic/brace-style': ['error', 'stroustrup'],
    '@stylistic/comma-dangle': 'error',
    '@stylistic/eol-last': 'error',
    '@stylistic/member-delimiter-style': 'error',
    '@stylistic/new-parens': 'error',
    '@stylistic/no-multiple-empty-lines': 'error',
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
    '@typescript-eslint/promise-function-async': 'error',
    'radix': 'error',
    'require-await': 'off',
    '@typescript-eslint/require-await': 'error',
    '@typescript-eslint/unified-signatures': 'error'
};

const javascriptRules = {
};


export default tseslint.config(
    {
        ignores: [
            'resources',
            '**/dist',
            'storage',
            'thunder-tests'
        ]
    },
    {
        files: [
            'src/**/*.ts'
        ],
        extends: [
            jseslint.configs.recommended,
            ...tseslint.configs.recommendedTypeChecked,
            ...tseslint.configs.stylisticTypeChecked,
            stylisticPlugin.configs['disable-legacy']
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
            ...stylisticRules
        }
    },
    {
        files: [
            'eslint.config.js'
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
