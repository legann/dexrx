/**
 * Environment adapter module for cross-platform work
 */
export type { IMemoryInfo, EnvironmentType, IEnvironmentAdapter } from './environment-adapter';

export {
  createEnvironmentAdapter,
  BrowserEnvironmentAdapter,
  NodeEnvironmentAdapter,
  UnknownEnvironmentAdapter,
} from './environment-adapter';
