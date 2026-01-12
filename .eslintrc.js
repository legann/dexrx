module.exports = {
  root: true, // Don't use configs from parent directories
  
  parser: '@typescript-eslint/parser',
  
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: ['./lib/dexrx/tsconfig.json'],
  },
  
  plugins: ['@typescript-eslint'],
  
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  
  // Global variables for Node.js and Browser environments
  globals: {
    // Common
    process: 'readonly',
    console: 'readonly',
    setTimeout: 'readonly',
    clearTimeout: 'readonly',
    setInterval: 'readonly',
    clearInterval: 'readonly',
    
    // Node.js
    NodeJS: 'readonly',
    __dirname: 'readonly',
    __filename: 'readonly',
    require: 'readonly',
    module: 'readonly',
    exports: 'readonly',
    global: 'readonly',
    
    // Browser
    window: 'readonly',
    document: 'readonly',
    navigator: 'readonly',
    URL: 'readonly',
    performance: 'readonly',
    
    // Web Workers
    Worker: 'readonly',
    MessageEvent: 'readonly',
    Event: 'readonly',
    AbortSignal: 'readonly',
    AbortController: 'readonly',
  },
  
  rules: {
    // TypeScript - Strict rules
    '@typescript-eslint/no-unused-vars': ['error', { 
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_'
    }],
    '@typescript-eslint/no-explicit-any': 'error', // Changed from 'warn' to 'error'
    '@typescript-eslint/explicit-function-return-type': ['warn', {
      allowExpressions: true,
      allowTypedFunctionExpressions: true,
      allowHigherOrderFunctions: true
    }],
    '@typescript-eslint/explicit-member-accessibility': ['warn', {
      accessibility: 'explicit',
      overrides: {
        constructors: 'no-public',
        methods: 'off' // Too verbose for public methods
      }
    }],
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': 'error',
    '@typescript-eslint/await-thenable': 'error',
    '@typescript-eslint/no-unnecessary-type-assertion': 'error',
    '@typescript-eslint/prefer-nullish-coalescing': 'warn',
    '@typescript-eslint/prefer-optional-chain': 'warn',
    '@typescript-eslint/prefer-readonly': 'warn',
    '@typescript-eslint/no-empty-function': 'off',
    '@typescript-eslint/ban-types': 'off',
    '@typescript-eslint/no-non-null-assertion': 'warn',
    
    // Base rules
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'prefer-const': 'error',
    'no-var': 'error',
    'prefer-template': 'error',
    'no-param-reassign': ['error', { props: false }],
    'eqeqeq': ['error', 'always', { null: 'ignore' }],
    'no-throw-literal': 'error',
    'prefer-promise-reject-errors': 'error',
  },
  
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'lib/dexrx/dist/',
    '**/*.js',
    '**/*.d.ts',
    'tests/',
    'karma.conf.js',
    'jest.config.ts',
  ],
};

