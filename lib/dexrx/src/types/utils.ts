/**
 * Utility types for DexRx
 * Collection of reusable type utilities
 */

/**
 * Type for node values (replaces any)
 */
export type NodeValue = unknown;

import type { IRuntimeContext } from './runtime-context';

/**
 * Type for node configuration
 * Strictly typed with __runtime field for runtime context
 */
export interface NodeConfig {
  /**
   * Runtime context added by withRuntimeContext operator
   * Plugins may modify this field (e.g., for state persistence)
   */
  __runtime?: IRuntimeContext;

  /**
   * Other node-specific configuration fields
   * Each node type may have different fields
   */
  [key: string]: unknown;
}

/**
 * Deep readonly utility type
 */
export type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends Record<string, unknown> ? DeepReadonly<T[P]> : T[P];
};

/**
 * Make specific properties required
 */
export type RequireProperties<T, K extends keyof T> = T & Required<Pick<T, K>>;

/**
 * Make specific properties optional
 */
export type OptionalProperties<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/**
 * Extract function parameter types
 */
export type FunctionParams<T> = T extends (...args: infer P) => unknown ? P : never;

/**
 * Extract async function return type
 */
export type AsyncReturnType<T extends (...args: readonly unknown[]) => Promise<unknown>> =
  T extends (...args: readonly unknown[]) => Promise<infer R> ? R : never;

/**
 * Branded type for type safety
 */
export type Brand<K, T> = K & { __brand: T };

/**
 * Node ID branded type
 */
export type NodeId = Brand<string, 'NodeId'>;

/**
 * Type predicate helper
 */
export type TypePredicate<T> = (value: unknown) => value is T;

/**
 * Non-nullable utility
 */
export type NonNullableFields<T> = {
  [P in keyof T]: NonNullable<T[P]>;
};

/**
 * Mutable version of readonly type
 */
export type Mutable<T> = {
  -readonly [P in keyof T]: T[P];
};

/**
 * Deep partial utility type
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends Record<string, unknown> ? DeepPartial<T[P]> : T[P];
};

/**
 * JSON-compatible value (non-circular, serializable)
 */
export type SerializableValue = string | number | boolean | null | undefined;

/**
 * Serializable type (no functions, symbols, etc.)
 */
export type Serializable =
  | SerializableValue
  | readonly Serializable[]
  | { readonly [key: string]: Serializable };

/**
 * JSON-compatible type
 */
export type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];

/**
 * Type guard for checking if value is defined
 */
export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/**
 * Type guard for checking if value is a string
 */
export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * Type guard for checking if value is a number
 */
export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value);
}

/**
 * Type guard for checking if value is an object
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Type guard for checking if value is an array
 */
export function isArray<T = unknown>(value: unknown): value is T[] {
  return Array.isArray(value);
}

/**
 * Type guard for checking if value is a function
 */
export function isFunction(value: unknown): value is (...args: readonly unknown[]) => unknown {
  return typeof value === 'function';
}

/**
 * Assert that value is defined (throws if not)
 */
export function assertDefined<T>(
  value: T | null | undefined,
  message?: string
): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message ?? 'Value must be defined');
  }
}

/**
 * Assert that condition is true (throws if not)
 */
export function assert(condition: boolean, message?: string): asserts condition {
  if (!condition) {
    throw new Error(message ?? 'Assertion failed');
  }
}
