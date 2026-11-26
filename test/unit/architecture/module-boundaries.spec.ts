import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const sourceRoot = join(process.cwd(), 'src');

function readSources(directory: string): string {
  return walk(directory)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
}

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      return walk(path);
    }

    return [path];
  });
}

describe('module boundaries', () => {
  it('keeps orders and instruments from importing each other internals', () => {
    const orders = readSources(join(sourceRoot, 'orders'));
    const instruments = readSources(join(sourceRoot, 'instruments'));
    const shared = readSources(join(sourceRoot, 'shared'));

    expect(orders).not.toContain('instruments/domain');
    expect(instruments).not.toContain('orders/');
    expect(shared).not.toContain('orders/');
    expect(shared).not.toContain('instruments/');
  });
});
