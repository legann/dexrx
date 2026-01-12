const path = require('path');
const os = require('os');

// Automatic detection of Chrome/Chromium path
function getChromePath() {
  const platform = os.platform();
  
  if (platform === 'linux') {
    // Check snap chromium
    if (require('fs').existsSync('/snap/bin/chromium')) {
      return '/snap/bin/chromium';
    }
    // Check regular installation
    if (require('fs').existsSync('/usr/bin/chromium-browser')) {
      return '/usr/bin/chromium-browser';
    }
    if (require('fs').existsSync('/usr/bin/google-chrome')) {
      return '/usr/bin/google-chrome';
    }
  }
  
  // Return undefined so Karma uses system PATH
  return undefined;
}

module.exports = function(config) {
  const chromePath = getChromePath();
  if (chromePath) {
    process.env.CHROME_BIN = chromePath;
  }

  config.set({
    // Base path used to resolve all relative paths
    basePath: '',

    // Frameworks to use
    frameworks: ['jasmine', 'webpack'],

    // List of files/patterns to load in the browser
    files: [
      // Load Karma tests
      { pattern: 'tests/karma/**/*.test.ts', type: 'module' },
      // Serve but don't include worker scripts from tests directory
      { 
        pattern: 'tests/workers/*.js', 
        included: false, 
        served: true, 
        nocache: false 
      }
      // Removed old path that is no longer used
    ],

    // List of files/patterns to exclude
    exclude: [
      'lib/dexrx/src/core/execution/node-worker-context.ts'
    ],

    // Preprocess matching files before serving them to the browser
    preprocessors: {
      'tests/karma/**/*.test.ts': ['webpack', 'sourcemap']
    },

    // Webpack configuration
    webpack: {
      mode: 'development',
      devtool: 'inline-source-map',
      resolve: {
        extensions: ['.ts', '.js'],
        alias: {
          '@dexrx': path.resolve(__dirname, 'lib/dexrx/src'),
          'dexrx': path.resolve(__dirname, 'lib/dexrx/src')
        },
        fallback: {
          fs: false,
          path: false,
          os: false,
          worker_threads: false
        }
      },
      module: {
        rules: [
          {
            test: /\.ts$/,
            use: {
              loader: 'ts-loader',
              options: {
                transpileOnly: true,
                compilerOptions: {
                  module: 'es2015'
                }
              }
            },
            exclude: /node_modules/
          }
        ]
      }
    },

    webpackMiddleware: {
      stats: 'errors-only'
    },

    // Test results reporters
    reporters: ['progress'],

    // Web server port
    port: 9876,

    // Enable/disable colors in the output and console
    colors: true,

    // Logging level
    // Possible values: config.LOG_DISABLE || config.LOG_ERROR || config.LOG_WARN || config.LOG_INFO || config.LOG_DEBUG
    logLevel: config.LOG_INFO,

    // Enable/disable watching file and executing tests whenever any file changes
    autoWatch: true,

    // Start these browsers
    browsers: ['ChromeHeadless'],

    // Configuration for headless Chrome
    customLaunchers: {
      ChromeHeadless: {
        base: 'Chrome',
        flags: [
          '--headless',
          '--disable-gpu',
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-setuid-sandbox',
          '--remote-debugging-port=9222'
        ]
      }
    },

    // Continuous Integration mode
    // If true, Karma captures browsers, runs the tests and exits
    // Use environment variable or command line argument to toggle mode
    singleRun: process.env.KARMA_SINGLE_RUN === 'true' || process.argv.includes('--single-run'),

    // Concurrency level
    // How many browsers should be started simultaneously
    concurrency: Infinity,

    // Proxy configuration for web workers
    proxies: {
      '/base/worker/': '/base/tests/workers/',
      '/worker/': '/base/tests/workers/'
    },

    // Timeout for browser launch
    browserNoActivityTimeout: 60000
  });
}; 