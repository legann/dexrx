import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Adapter for testing node-shims
 * Provides functionality that should be in node-shims module
 */
export class NodeShimsAdapter {
  /**
   * Checks if code is running in Node.js environment
   */
  isNode(): boolean {
    return (
      typeof process !== 'undefined' && process.versions != null && process.versions.node != null
    );
  }

  /**
   * Checks if Node.js module exists
   */
  isNodeModule(moduleName: string): boolean {
    try {
      require.resolve(moduleName);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Safely loads module, returning undefined on error
   */
  requireSafe(moduleName: string): any {
    try {
      return require(moduleName);
    } catch (e) {
      // Suppress error output for test module non_existent_module,
      // as this is expected error used in tests
      if (moduleName !== 'non_existent_module') {
        console.error(`Error loading module ${moduleName}:`, e);
      }
      return undefined;
    }
  }

  /**
   * Returns environment variables
   */
  getProcessEnv(): NodeJS.ProcessEnv {
    return process.env;
  }

  /**
   * Returns Node.js version
   */
  getNodeVersion(): string {
    return process.version;
  }

  /**
   * Returns CPU core count
   */
  getCpuCount(): number {
    return os.cpus().length;
  }

  /**
   * Returns memory usage information
   */
  getMemoryUsage(): NodeJS.MemoryUsage {
    return process.memoryUsage();
  }

  /**
   * Returns path to temporary directory
   */
  getTempDirectory(): string {
    return os.tmpdir();
  }

  /**
   * Checks if file exists
   */
  fileExists(filePath: string): boolean {
    try {
      return fs.existsSync(filePath);
    } catch (e) {
      return false;
    }
  }

  /**
   * Reads file content synchronously
   */
  readFileSync(filePath: string): string | undefined {
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      return undefined;
    }
  }

  /**
   * Writes data to file synchronously
   */
  writeFileSync(filePath: string, data: string): boolean {
    try {
      fs.writeFileSync(filePath, data, 'utf8');
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Joins path segments
   */
  joinPaths(...paths: string[]): string {
    return path.join(...paths);
  }

  /**
   * Returns directory name from file path
   */
  dirname(filePath: string): string {
    return path.dirname(filePath);
  }

  /**
   * Creates directory if it doesn't exist
   */
  ensureDirectoryExists(dirPath: string): boolean {
    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      return true;
    } catch (e) {
      return false;
    }
  }
}
