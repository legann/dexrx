import { ILogger } from './logger';

/**
 * Interface for input data validation service
 */
export interface IInputGuardService {
  /**
   * Sets logger for input data validation service
   * @param logger Logger instance to use for validation errors
   */
  setLogger(logger: ILogger): void;

  /**
   * Validates URL for safety
   * @param url URL to validate
   */
  validateUrl(url: string): void;

  /**
   * Validates JSON Path for safety
   * @param path JSON Path to validate
   */
  validateJsonPath(path: string): void;

  /**
   * Validates HTTP method for safety
   * @param method HTTP method to validate
   */
  validateHttpMethod(method: string): void;

  /**
   * Validates HTTP request headers for safety
   * @param headers Headers to validate
   */
  validateHttpHeaders(headers: Record<string, string>): void;

  /**
   * Validates value for safety in various contexts
   * @param value Value to validate
   * @param context Context description for error messages
   */
  validateValue(value: unknown, context: string): void;

  /**
   * Checks if value is valid URL
   * @param value Value to check
   * @returns True if value is a valid URL
   */
  isValidUrl(value: unknown): boolean;

  /**
   * Checks for potentially dangerous characters in string
   * @param value Value to check
   * @param maxLength Maximum allowed string length
   * @returns Type guard indicating if value is a safe string
   */
  isSafeString(value: unknown, maxLength?: number): value is string;

  /**
   * Checks if string is numeric
   * @param value Value to check
   * @returns True if value is a numeric string
   */
  isNumericString(value: unknown): boolean;

  /**
   * String sanitization
   * @param value Value to sanitize
   * @param maxLength Maximum allowed string length
   * @returns Sanitized string
   */
  sanitizeString(value: unknown, maxLength?: number): string;

  /**
   * Safe conversion to number
   * @param value Value to convert
   * @returns Converted number
   */
  sanitizeNumber(value: unknown): number;

  /**
   * URL validation with dangerous character cleanup
   * @param value Value to sanitize
   * @returns Sanitized URL string
   */
  sanitizeUrl(value: unknown): string;

  /**
   * Object key safety check
   * @param key Key to check
   * @returns True if key is safe to use as object key
   */
  isSafeObjectKey(key: string): boolean;

  /**
   * Deep sanitization of objects/arrays
   * @param value Value to sanitize
   * @param depth Current recursion depth
   * @param maxDepth Maximum allowed recursion depth
   * @returns Sanitized value
   */
  deepSanitize(value: unknown, depth?: number, maxDepth?: number): unknown;
}
