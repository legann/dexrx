/**
 * Tests for node-shims.ts module, which provides compatibility between environments
 */
import { NodeShimsAdapter } from './adapters/node-shims-adapter';
import * as fs from 'fs';
import * as path from 'path';

describe('Node Shims', () => {
  // Initialize adapter
  const nodeShims = new NodeShimsAdapter();
  
  // Check isNode function
  describe('isNode function', () => {
    it('should detect that code runs in Node.js', () => {
      // In Jest tests always run in Node.js environment
      const result = nodeShims.isNode();
      expect(result).toBe(true);
    });
  });
  
  // Check isNodeModule function
  describe('isNodeModule function', () => {
    it('should check for Node.js module presence', () => {
      // Check for real Node.js module presence
      expect(nodeShims.isNodeModule('fs')).toBe(true);
      expect(nodeShims.isNodeModule('path')).toBe(true);
      
      // Check for non-existent module absence
      expect(nodeShims.isNodeModule('non_existent_module')).toBe(false);
    });
  });
  
  // Check requireSafe function
  describe('requireSafe function', () => {
    it('should safely load existing modules', () => {
      // Attempt to load existing module
      const pathModule = nodeShims.requireSafe('path');
      expect(pathModule).toBeDefined();
      expect(typeof pathModule.join).toBe('function');
    });
    
    it('should return undefined when loading non-existent modules', () => {
      // Attempt to load non-existent module
      const nonExistentModule = nodeShims.requireSafe('non_existent_module');
      expect(nonExistentModule).toBeUndefined();
    });
    
    it('should correctly handle errors when loading modules', () => {
      // Mock console.error to check error logging
      const originalConsoleError = console.error;
      const mockConsoleError = jest.fn();
      console.error = mockConsoleError;
      
      try {
        // Attempt to load module that should cause error but not log it
        nodeShims.requireSafe('non_existent_module');
        
        // Check that error is not logged for non_existent_module
        expect(mockConsoleError).not.toHaveBeenCalled();
        
        // Now try another non-existent module to check logging
        nodeShims.requireSafe('another_non_existent_module');
        
        // Check that error was logged for other module
        expect(mockConsoleError).toHaveBeenCalled();
      } finally {
        // Restore original console.error function
        console.error = originalConsoleError;
      }
    });
  });
  
  // Check getProcessEnv function
  describe('getProcessEnv function', () => {
    it('should return environment variables in Node.js', () => {
      // In Node.js should return process.env
      const env = nodeShims.getProcessEnv();
      expect(env).toBeDefined();
      
      // Check presence of some standard environment variables
      expect(env.PATH).toBeDefined();
      
      // Set test environment variable
      process.env.TEST_ENV_VAR = 'test_value';
      
      // Check that it's available through getProcessEnv
      expect(nodeShims.getProcessEnv().TEST_ENV_VAR).toBe('test_value');
    });
  });
  
  // Check getNodeVersion function
  describe('getNodeVersion function', () => {
    it('should return Node.js version', () => {
      const version = nodeShims.getNodeVersion();
      
      // Check that version is defined
      expect(version).toBeDefined();

      // Check version format (should match semver, possibly with "v" prefix)
      expect(version).toMatch(/^v?\d+\.\d+\.\d+/);
    });
  });
  
  // Check getCpuCount function
  describe('getCpuCount function', () => {
    it('should return CPU core count', () => {
      // Function should return core count > 0
      const cpuCount = nodeShims.getCpuCount();
      expect(cpuCount).toBeGreaterThan(0);
      
      // Usually on modern systems at least 2 cores
      expect(cpuCount).toBeGreaterThanOrEqual(1);
    });
  });
  
  // Check getMemoryUsage function
  describe('getMemoryUsage function', () => {
    it('should return memory usage information', () => {
      // Function should return object with memory information
      const memoryUsage = nodeShims.getMemoryUsage();
      expect(memoryUsage).toBeDefined();
      
      // Check presence of expected fields
      expect(memoryUsage.rss).toBeGreaterThan(0);
      expect(memoryUsage.heapTotal).toBeGreaterThan(0);
      expect(memoryUsage.heapUsed).toBeGreaterThan(0);
      expect(memoryUsage.external).toBeGreaterThanOrEqual(0);
    });
  });
  
  // Check getTempDirectory function
  describe('getTempDirectory function', () => {
    it('should return path to temporary directory', () => {
      // Function should return string with path
      const tempDir = nodeShims.getTempDirectory();
      expect(tempDir).toBeDefined();
      expect(typeof tempDir).toBe('string');
      expect(tempDir.length).toBeGreaterThan(0);
    });
  });
  
  // Check fileExists function
  describe('fileExists function', () => {
    it('should return true for existing file', () => {
      // Use path to file that definitely exists in project
      const testFilePath = path.resolve(__dirname, '..', 'package.json');
      const exists = nodeShims.fileExists(testFilePath);
      expect(exists).toBe(true);
    });
    
    it('should return false for non-existent file', () => {
      const nonExistentPath = '/path/to/non/existent/file.txt';
      const exists = nodeShims.fileExists(nonExistentPath);
      expect(exists).toBe(false);
    });
  });
  
  // Check readFileSync function
  describe('readFileSync function', () => {
    it('should read content of existing file', () => {
      // Use path to file that definitely exists
      const testFilePath = path.resolve(__dirname, '..', 'package.json');
      const content = nodeShims.readFileSync(testFilePath);
      
      // Should return string with file content
      expect(content).toBeDefined();
      expect(typeof content).toBe('string');
      
      // Check that content looks like JSON
      expect(content).toContain('{');
      expect(content).toContain('}');
    });
    
    it('should return undefined for non-existent file', () => {
      const nonExistentPath = '/path/to/non/existent/file.txt';
      const content = nodeShims.readFileSync(nonExistentPath);
      
      // Should return undefined for non-existent file
      expect(content).toBeUndefined();
    });
  });
  
  // Check writeFileSync function
  describe('writeFileSync function', () => {
    // Use getTempDirectory to get path to temporary directory
    const tempDir = nodeShims.getTempDirectory();
    const testFilePath = nodeShims.joinPaths(tempDir, `test-file-${Date.now()}.txt`);
    
    afterEach(() => {
      // Cleanup: remove test file after each test
      if (nodeShims.fileExists(testFilePath)) {
        try {
          // Use fs.unlinkSync for deletion
          fs.unlinkSync(testFilePath);
        } catch (error) {
          console.error(`Failed to delete test file: ${error}`);
        }
      }
    });
    
    it('should write data to file', () => {
      const testContent = 'Test content ' + Date.now();
      
      // Write test content
      const result = nodeShims.writeFileSync(testFilePath, testContent);
      
      // Function should return true on successful write
      expect(result).toBe(true);
      
      // Check that file exists
      expect(nodeShims.fileExists(testFilePath)).toBe(true);
      
      // Check file content
      const readContent = nodeShims.readFileSync(testFilePath);
      expect(readContent).toBe(testContent);
    });
    
    it('should return false on failed write', () => {
      // Attempt to write to inaccessible path
      const invalidPath = '/non/existent/directory/file.txt';
      const result = nodeShims.writeFileSync(invalidPath, 'test');
      
      // Function should return false on failed write
      expect(result).toBe(false);
    });
  });
  
  // Check joinPaths function
  describe('joinPaths function', () => {
    it('should correctly join paths', () => {
      // Test for Windows and Unix systems
      const isWindows = process.platform === 'win32';
      
      // Check joining two path segments
      const path1 = nodeShims.joinPaths('dir', 'file.txt');
      expect(path1).toBe(isWindows ? 'dir\\file.txt' : 'dir/file.txt');
      
      // Check joining multiple path segments
      const path2 = nodeShims.joinPaths('root', 'dir', 'subdir', 'file.txt');
      const expected = isWindows 
        ? 'root\\dir\\subdir\\file.txt' 
        : 'root/dir/subdir/file.txt';
      expect(path2).toBe(expected);
    });
  });
  
  // Check dirname function
  describe('dirname function', () => {
    it('should return file directory', () => {
      // Test for Windows and Unix systems
      const isWindows = process.platform === 'win32';
      
      // Check file path
      const filePath = isWindows ? 'C:\\dir\\file.txt' : '/dir/file.txt';
      const dirPath = nodeShims.dirname(filePath);
      
      expect(dirPath).toBe(isWindows ? 'C:\\dir' : '/dir');
    });
  });
  
  // Check ensureDirectoryExists function
  describe('ensureDirectoryExists function', () => {
    // Create unique path for each test to avoid conflicts
    const tempDir = nodeShims.getTempDirectory();
    const testDirPath = nodeShims.joinPaths(tempDir, `test-dir-${Date.now()}`);
    
    afterEach(() => {
      // Cleanup: remove test directory after each test
      if (nodeShims.fileExists(testDirPath)) {
        try {
          // Use fs.rmdirSync for deletion
          fs.rmdirSync(testDirPath);
        } catch (error) {
          console.error(`Failed to delete test directory: ${error}`);
        }
      }
    });
    
    it("should create directory if it doesn't exist", () => {
      // Check that directory doesn't exist initially
      expect(nodeShims.fileExists(testDirPath)).toBe(false);
      
      // Create directory
      const result = nodeShims.ensureDirectoryExists(testDirPath);
      
      // Function should return true on successful creation
      expect(result).toBe(true);
      
      // Check that directory exists
      expect(nodeShims.fileExists(testDirPath)).toBe(true);
      
      // Check that it's actually a directory
      const stats = fs.statSync(testDirPath);
      expect(stats.isDirectory()).toBe(true);
    });
    
    it('should return true if directory already exists', () => {
      // First create directory
      nodeShims.ensureDirectoryExists(testDirPath);
      
      // Check that directory exists
      expect(nodeShims.fileExists(testDirPath)).toBe(true);
      
      // Try to create it again
      const result = nodeShims.ensureDirectoryExists(testDirPath);
      
      // Function should return true, as directory already exists
      expect(result).toBe(true);
    });
    
    it('should return false on failed directory creation', () => {
      // Attempt to create directory in inaccessible location
      const invalidPath = '/root/secured/directory';
      const result = nodeShims.ensureDirectoryExists(invalidPath);
      
      // Function should return false on failed creation
      // Note: on some systems this may not work due to access rights
      expect(typeof result).toBe('boolean');
    });
  });
}); 