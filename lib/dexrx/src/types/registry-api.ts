import { INodePlugin } from './node-plugin';

export interface INodeRegistry {
  register(plugin: INodePlugin): void;
  get(type: string): INodePlugin;
  getPluginTypes(): IterableIterator<string>;
}
