import { IInputGuardService } from '../../types/input-guard';
import { ILogger } from '../../types/logger';
import { LoggerManager } from '../logging/logger-manager';

/**
 * Class for input data validation errors
 */
export class InputGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputGuardError';
    // For ES5 compatibility
    Object.setPrototypeOf(this, InputGuardError.prototype);
  }
}

/**
 * Constant for dangerous pattern
 */
const dangerousPattern = /[<>"'&;]/;

/**
 * Service for input data validation and sanitization
 */
export class InputGuardService implements IInputGuardService {
  private logger: ILogger;

  constructor() {
    // By default get logger from LoggerManager
    this.logger = LoggerManager.getInstance().getLogger();
  }

  /**
   * Sets logger for service
   */
  setLogger(logger: ILogger): void {
    this.logger = logger;
  }

  /**
   * Validates URL for safety
   * @param url URL to validate
   * @throws InputGuardError if URL is unsafe
   */
  validateUrl(url: string): void {
    // Simple URL validation
    const urlRegex = /^(https?:\/\/)?[\w.-]+\.\w{2,}(\/[\w.-]*)*\/?(\?\S*)?$/;
    if (!url || !urlRegex.test(url)) {
      const errorMsg = `Invalid URL: ${url}`;
      this.logger.inputGuardError(errorMsg);
      throw new InputGuardError(errorMsg);
    }
  }

  /**
   * Validates JSON Path for safety
   * @param path JSON Path to validate
   * @throws InputGuardError if JSON Path is unsafe
   */
  validateJsonPath(path: string): void {
    // Check for potentially dangerous constructs in JSONPath
    const dangerousPatterns = [/<script>/i, /javascript:/i, /eval\(/i, /function\(/i];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(path)) {
        const errorMsg = `Invalid JSONPath: ${path}`;
        this.logger.inputGuardError(errorMsg);
        throw new InputGuardError(errorMsg);
      }
    }
  }

  /**
   * Validates HTTP method for safety
   * @param method HTTP method to validate
   * @throws InputGuardError if method is unsafe
   */
  validateHttpMethod(method: string): void {
    const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
    if (!validMethods.includes(method.toUpperCase())) {
      const errorMsg = `Invalid HTTP method: ${method}`;
      this.logger.inputGuardError(errorMsg);
      throw new InputGuardError(errorMsg);
    }
  }

  /**
   * Validates HTTP request headers for safety
   * @param headers Headers to validate
   * @throws InputGuardError if headers are unsafe
   */
  validateHttpHeaders(headers: Record<string, string>): void {
    const dangerousHeadersPatterns = [/javascript:/i, /<script>/i, /eval\(/i, /function\(/i];

    for (const header in headers) {
      const value = headers[header];

      // Skip undefined values
      if (!value) {
        continue;
      }

      // Validate header values
      for (const pattern of dangerousHeadersPatterns) {
        if (pattern.test(value)) {
          const errorMsg = `Invalid header value: ${header}=${value}`;
          this.logger.inputGuardError(errorMsg);
          throw new InputGuardError(errorMsg);
        }
      }
    }
  }

  /**
   * Validates value for safety in various contexts
   * @param value Value to validate
   * @param context Validation context (url, jsonPath, etc)
   * @throws InputGuardError if value is unsafe
   */
  validateValue(value: unknown, context: string): void {
    if (typeof value === 'string') {
      switch (context) {
        case 'url':
          this.validateUrl(value);
          break;
        case 'jsonPath':
          this.validateJsonPath(value);
          break;
        case 'httpMethod':
          this.validateHttpMethod(value);
          break;
      }
    } else if (context === 'headers' && typeof value === 'object' && value !== null) {
      this.validateHttpHeaders(value as Record<string, string>);
    }
  }

  /**
   * Checks if value is valid URL
   */
  isValidUrl(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Checks for potentially dangerous characters in string
   */
  isSafeString(value: unknown, maxLength = 256): value is string {
    return typeof value === 'string' && value.length <= maxLength && !dangerousPattern.test(value);
  }

  /**
   * Checks if string is numeric
   */
  isNumericString(value: unknown): boolean {
    return typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value);
  }

  /**
   * String sanitization (removes dangerous characters)
   */
  sanitizeString(value: unknown, maxLength = 256): string {
    if (typeof value !== 'string') return '';

    // Truncate to maximum length
    let sanitized = value.slice(0, maxLength);

    // Replace dangerous characters
    sanitized = sanitized.replace(dangerousPattern, '');

    return sanitized;
  }

  /**
   * Safe conversion to number
   */
  sanitizeNumber(value: unknown): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && this.isNumericString(value)) {
      return parseFloat(value);
    }
    return 0;
  }

  /**
   * URL validation with dangerous character cleanup
   */
  sanitizeUrl(value: unknown): string {
    if (!value || typeof value !== 'string') return '';

    try {
      // Try to create URL to validate it
      const url = new URL(value);
      // Return "cleaned" URL
      return url.toString();
    } catch {
      return '';
    }
  }

  /**
   * Object key safety check
   * Blocks potentially dangerous keys that can be used
   * for prototype pollution attacks
   */
  isSafeObjectKey(key: string): boolean {
    // List of potentially dangerous keys
    const dangerousKeys = [
      '__proto__',
      'constructor',
      'prototype',
      'toJSON',
      'toString',
      'valueOf',
      'hasOwnProperty',
      'isPrototypeOf',
      'propertyIsEnumerable',
      'eval',
      'uneval',
      'setTimeout',
      'setInterval',
    ];

    return (
      typeof key === 'string' &&
      !dangerousKeys.includes(key) &&
      !key.startsWith('__') &&
      this.isSafeString(key)
    );
  }

  /**
   * Deep sanitization of objects/arrays with maximum depth check
   * to prevent DoS attacks and protect against dangerous data
   */
  deepSanitize(value: unknown, depth = 0, maxDepth = 10): unknown {
    // Check maximum depth to prevent DoS attacks
    if (depth > maxDepth) {
      return null;
    }

    // For primitives return safe value
    if (value === null || value === undefined) {
      return value;
    }

    // Handle strings
    if (typeof value === 'string') {
      return this.isSafeString(value) ? value : this.sanitizeString(value);
    }

    // Handle numbers
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : 0;
    }

    // Handle booleans
    if (typeof value === 'boolean') {
      return value;
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return value.map(item => this.deepSanitize(item, depth + 1, maxDepth));
    }

    // Handle objects
    if (typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key) && this.isSafeObjectKey(key)) {
          result[key] = this.deepSanitize(
            (value as Record<string, unknown>)[key],
            depth + 1,
            maxDepth
          );
        }
      }
      return result;
    }

    // Block functions and other types
    if (typeof value === 'function' || typeof value === 'symbol') {
      return null;
    }

    return null;
  }
}
