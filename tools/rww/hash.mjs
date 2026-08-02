import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function sha256File(path) {
  return sha256(await readFile(path));
}

export function sha256Json(value) {
  return sha256(canonicalJson(value));
}

export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortValue(child)]),
    );
  }
  return value;
}
