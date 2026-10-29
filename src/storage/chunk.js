import { MAX_KVS_PART_CHARS } from '../collect/constants.js';

/**
 * Split a JSON value into KVS-sized pieces. Parts are base64 so a multibyte
 * character is never cut in half. A value that fits is returned unchunked
 * so it stays readable in the Key-Value Store.
 * @param {unknown} value
 * @param {number} [maxChars]
 */
export function packValue(value, maxChars = MAX_KVS_PART_CHARS) {
  const json = JSON.stringify(value);
  if (json.length <= maxChars) {
    return { chunked: false, value, bytes: Buffer.byteLength(json, 'utf8'), parts: [] };
  }
  const encoded = Buffer.from(json, 'utf8').toString('base64');
  /** @type {string[]} */
  const parts = [];
  for (let index = 0; index < encoded.length; index += maxChars) {
    parts.push(encoded.slice(index, index + maxChars));
  }
  return {
    chunked: true,
    value: null,
    bytes: Buffer.byteLength(json, 'utf8'),
    parts,
  };
}

/**
 * @param {{ chunked?: boolean, parts?: string[], value?: unknown }} packed
 * @param {string[] | undefined} storedParts
 */
export function unpackValue(record, storedParts) {
  if (!record || !record.chunked) {
    return record;
  }
  const encoded = (storedParts || []).join('');
  const json = Buffer.from(encoded, 'base64').toString('utf8');
  return JSON.parse(json);
}
