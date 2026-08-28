import { InputGuardService } from '../lib/dexrx/src/utils/input-guard/input-guard-service';

describe('InputGuardService', () => {
  let guard: InputGuardService;

  beforeEach(() => {
    guard = new InputGuardService();
  });

  describe('sanitizeString (I1: strips ALL dangerous chars, not just the first)', () => {
    it('removes every dangerous character', () => {
      expect(guard.sanitizeString(`a<b>c&d;e"f'g`)).toBe('abcdefg');
    });

    it('produces output that isSafeString accepts — the sanitizer must not emit what it rejects', () => {
      const dirty = `<script>alert('xss')&more;</script>`;
      const clean = guard.sanitizeString(dirty);
      expect(guard.isSafeString(clean)).toBe(true);
    });

    it('truncates to maxLength before sanitizing', () => {
      expect(guard.sanitizeString('abcdef', 3)).toBe('abc');
    });

    it('returns empty string for non-string input', () => {
      expect(guard.sanitizeString(42)).toBe('');
      expect(guard.sanitizeString(null)).toBe('');
      expect(guard.sanitizeString(undefined)).toBe('');
    });
  });

  describe('isSafeString (stateless — guards against a global-regex .test() regression)', () => {
    it('is consistent across repeated calls for an unsafe string', () => {
      const v = 'a<b';
      expect(guard.isSafeString(v)).toBe(false);
      expect(guard.isSafeString(v)).toBe(false);
      expect(guard.isSafeString(v)).toBe(false);
    });

    it('is consistent across repeated calls for a safe string', () => {
      const v = 'abc';
      expect(guard.isSafeString(v)).toBe(true);
      expect(guard.isSafeString(v)).toBe(true);
      expect(guard.isSafeString(v)).toBe(true);
    });

    it('rejects strings over maxLength', () => {
      expect(guard.isSafeString('x'.repeat(300))).toBe(false);
    });

    it('rejects non-strings', () => {
      expect(guard.isSafeString(42)).toBe(false);
      expect(guard.isSafeString({})).toBe(false);
    });
  });

  describe('isSafeObjectKey (prototype-pollution guard)', () => {
    it('rejects dangerous keys', () => {
      expect(guard.isSafeObjectKey('__proto__')).toBe(false);
      expect(guard.isSafeObjectKey('constructor')).toBe(false);
      expect(guard.isSafeObjectKey('prototype')).toBe(false);
    });

    it('accepts ordinary keys', () => {
      expect(guard.isSafeObjectKey('name')).toBe(true);
      expect(guard.isSafeObjectKey('value_1')).toBe(true);
    });
  });

  describe('deepSanitize', () => {
    it('sanitizes nested string values', () => {
      const out = guard.deepSanitize({ a: 'x<y', nested: { b: 'p&q' } }) as {
        a: string;
        nested: { b: string };
      };
      expect(out.a).toBe('xy');
      expect(out.nested.b).toBe('pq');
    });

    it('drops prototype-pollution and __-prefixed keys (I6-documented behavior)', () => {
      // JSON.parse yields real own "__proto__"/"constructor" keys (unlike an object literal).
      const input = JSON.parse('{"__proto__":"p","constructor":"c","__meta":"m","safe":"z<w"}');
      const out = guard.deepSanitize(input) as Record<string, unknown>;
      expect(Object.keys(out)).toEqual(['safe']);
      expect(out.safe).toBe('zw');
    });

    it('truncates below maxDepth to null (I6-documented behavior)', () => {
      const deep = { a: { b: { c: 'x' } } };
      expect(guard.deepSanitize(deep, 0, 1)).toEqual({ a: { b: null } });
    });

    it('does not pollute Object.prototype when given __proto__/constructor keys', () => {
      const payload = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"x":1},"ok":"v"}');
      guard.deepSanitize(payload);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
    });
  });

  describe('isNumericString / sanitizeNumber', () => {
    it('detects numeric strings', () => {
      expect(guard.isNumericString('42')).toBe(true);
      expect(guard.isNumericString('-3.14')).toBe(true);
      expect(guard.isNumericString('abc')).toBe(false);
      expect(guard.isNumericString('12px')).toBe(false);
    });

    it('sanitizeNumber parses numeric input, passes through numbers', () => {
      expect(guard.sanitizeNumber('42')).toBe(42);
      expect(guard.sanitizeNumber(7)).toBe(7);
    });
  });
});
