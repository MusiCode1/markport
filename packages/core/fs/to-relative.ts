/**
 * Strip leading '/' characters from a path string.
 * Only strips forward slashes — backslash is a valid POSIX filename character.
 *
 * @throws TypeError if `rel` is not a string
 */
export function toRelative(rel: string): string {
  if (typeof rel !== 'string') {
    throw new TypeError('path must be a string');
  }
  return rel.replace(/^\/+/, '');
}
