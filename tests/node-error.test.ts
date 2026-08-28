import {
  createNodeError,
  isNodeError,
  isSkipInputException,
  isEngineError,
  getErrorMessage,
  SkipInputException,
} from '../lib/dexrx/src/utils/node-error';

describe('NodeError contract', () => {
  it('carries nodeId/originalError and serializes via toJSON', () => {
    const original = new Error('boom');
    const err = createNodeError('compute failed', 'node-1', original);
    expect(err).toBeInstanceOf(Error);
    expect(isNodeError(err)).toBe(true);
    expect(err.nodeId).toBe('node-1');
    expect(err.originalError).toBe(original);
    expect(err.toJSON().nodeId).toBe('node-1');
  });
});

describe('error taxonomy helpers', () => {
  it('isEngineError classifies NodeError and SkipInputException', () => {
    expect(isEngineError(createNodeError('x', 'n'))).toBe(true);
    expect(isEngineError(new SkipInputException('n'))).toBe(true);
    expect(isEngineError(new Error('plain'))).toBe(false);
  });

  it('isSkipInputException matches by name (cross-realm fallback)', () => {
    expect(isSkipInputException(new SkipInputException('n'))).toBe(true);
    const faux = Object.assign(new Error('x'), { name: 'SkipInputException', nodeId: 'n' });
    expect(isSkipInputException(faux)).toBe(true);
    expect(isSkipInputException(new Error('x'))).toBe(false);
  });

  it('getErrorMessage extracts a string message from varied inputs', () => {
    expect(getErrorMessage(new Error('hi'))).toContain('hi');
    expect(getErrorMessage('str')).toBe('str');
    expect(typeof getErrorMessage({ weird: true })).toBe('string');
  });
});
