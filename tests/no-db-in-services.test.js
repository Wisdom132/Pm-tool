import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const API = new URL('../apps/api/src', import.meta.url).pathname;

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(API)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => ({ path: f, rel: relative(API, f), source: readFileSync(f, 'utf8') }));

/** Where database access is allowed to live. */
const isRepository = (rel) => rel.endsWith('.repository.ts');
const isPrismaItself = (rel) => rel.startsWith('prisma/');

describe('the repository boundary', () => {
  it('finds the API sources', () => {
    // Guards the test itself: a broken path would make everything below
    // pass vacuously.
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => isRepository(f.rel))).toBe(true);
  });

  it('only repositories import PrismaService', () => {
    const offenders = files
      .filter((f) => !isRepository(f.rel) && !isPrismaItself(f.rel))
      .filter((f) => /PrismaService/.test(f.source))
      .map((f) => f.rel);

    expect(offenders).toEqual([]);
  });

  it('no service, controller or guard issues a query', () => {
    // `this.prisma.x.findMany`, `prisma.$transaction`, `tx.y.create` — the
    // shapes that mean a database call, wherever they appear outside a
    // repository.
    //
    // Import lines are stripped first: `from './prisma/prisma.module'`
    // contains the same characters as a query and is not one.
    const query = /\bthis\.prisma\.|\bprisma\.\$|\btx\.\w+\.\w+\(/;
    const withoutImports = (source) =>
      source
        .split('\n')
        .filter((line) => !/^\s*(import|export)\s.*from\s/.test(line))
        .join('\n');

    const offenders = files
      .filter((f) => !isRepository(f.rel) && !isPrismaItself(f.rel))
      .filter((f) => query.test(withoutImports(f.source)))
      .map((f) => f.rel);

    expect(offenders).toEqual([]);
  });

  it('catches a query that sneaks back into a service', () => {
    // Proves the check above is not vacuous.
    const query = /\bthis\.prisma\.|\bprisma\.\$|\btx\.\w+\.\w+\(/;
    expect(query.test('const x = await this.prisma.user.findMany();')).toBe(true);
    expect(query.test('return this.prisma.$transaction(async (tx) => {')).toBe(true);
    expect(query.test('await tx.auditEvent.create({ data });')).toBe(true);
    expect(query.test("import { PrismaModule } from './prisma/prisma.module';")).toBe(false);
  });

  it('every repository is named for the boundary it sits on', () => {
    // A file that imports PrismaService but is not called *.repository.ts
    // would satisfy the check above only by accident of its name.
    const usingPrisma = files
      .filter((f) => !isPrismaItself(f.rel))
      .filter((f) => /from '.*prisma\/prisma\.service'/.test(f.source))
      .map((f) => f.rel);

    expect(usingPrisma.every(isRepository)).toBe(true);
    expect(usingPrisma.length).toBeGreaterThanOrEqual(5);
  });

  it('each repository lives beside the feature it serves', () => {
    // The whole point of not having a central persistence/ folder.
    const stranded = files
      .filter((f) => isRepository(f.rel))
      .filter((f) => !f.rel.includes('/'))
      .map((f) => f.rel);

    expect(stranded).toEqual([]);
  });
});
