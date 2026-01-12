/**
 * Engine execution flags
 *
 * Internal flags used by the engine to manage node execution state.
 * Available to plugin developers for checking node state and execution flow.
 *
 * @category Plugin Development
 */

/**
 * Initial execution flag for reactive streams
 *
 * Used internally by the engine to initialize BehaviorSubject streams in RxJS.
 * Plugin developers can check for this value to determine if a node has been initialized.
 *
 * This flag is emitted as the initial value in reactive streams and is automatically
 * filtered out by the engine using `skipWhile(values => values.includes(INIT_NODE_EXEC))`.
 *
 * @category Plugin Development
 */
export const INIT_NODE_EXEC = Symbol('INIT_NODE_EXEC');

/**
 * Skip execution flag for data nodes
 *
 * Used by the engine to indicate that a data node was not triggered and should be skipped.
 * In ASYNC_EXEC_MODE, data nodes that are not explicitly triggered return this flag.
 *
 * Operational nodes automatically check for SKIP_NODE_EXEC in their inputs and throw
 * SkipInputException when detected, which the engine handles gracefully.
 *
 * @category Plugin Development
 */
export const SKIP_NODE_EXEC = Symbol('SKIP_NODE_EXEC');
