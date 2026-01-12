/**
 * Exception for cases when operational nodes receive skip at input
 * (when data nodes were not triggered)
 */
export class SkipInputException extends Error {
  public readonly nodeId: string;

  constructor(nodeId: string) {
    super(`Skip input detected in operational node ${nodeId} - some data nodes were not triggered`);
    this.name = 'SkipInputException';
    this.nodeId = nodeId;

    // For ES5 compatibility
    Object.setPrototypeOf(this, SkipInputException.prototype);
  }
}
