import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toRelative } from './to-relative.ts';

describe('toRelative', () => {
  it('strips a single leading slash', () => {
    assert.equal(toRelative('/'), '');
  });

  it('strips multiple leading slashes', () => {
    assert.equal(toRelative('//'), '');
  });

  it('strips leading slash from a path', () => {
    assert.equal(toRelative('/a/b'), 'a/b');
  });

  it('leaves a relative path unchanged', () => {
    assert.equal(toRelative('a/b'), 'a/b');
  });

  it('strips leading slash from /etc/passwd', () => {
    assert.equal(toRelative('/etc/passwd'), 'etc/passwd');
  });

  it('does NOT strip backslash (valid POSIX filename)', () => {
    assert.equal(toRelative('\\'), '\\');
  });

  it('throws TypeError for non-string input', () => {
    assert.throws(
      () => toRelative(null as any),
      { name: 'TypeError', message: 'path must be a string' },
    );
  });
});
