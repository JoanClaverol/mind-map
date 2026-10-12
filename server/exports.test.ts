import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportBytes, saveExport } from './exports';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64');
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'mindmap-exports-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('exportBytes', () => {
  it('accepts real PNG and SVG payloads only', () => {
    expect(exportBytes({ format: 'png', data: PNG })).not.toBeNull();
    expect(exportBytes({ format: 'png', data: Buffer.from('#!/bin/sh').toString('base64') })).toBeNull();
    expect(exportBytes({ format: 'svg', data: '<?xml version="1.0"?>\n<svg xmlns="x"></svg>' })).not.toBeNull();
    expect(exportBytes({ format: 'svg', data: 'export PATH=evil' })).toBeNull();
  });
});

describe('saveExport', () => {
  it('replaces a planted symlink instead of writing through it', async () => {
    const victim = path.join(dir, 'victim.txt');
    writeFileSync(victim, 'precious');
    mkdirSync(path.join(dir, 'exports'));
    const target = path.join(dir, 'exports', 'map-abc.png');
    symlinkSync(victim, target);
    await saveExport(dir, 'map-abc', { format: 'png', data: PNG });
    expect(readFileSync(victim, 'utf8')).toBe('precious');
    expect(lstatSync(target).isSymbolicLink()).toBe(false);
  });

  it('refuses a symlinked exports directory', async () => {
    const elsewhere = path.join(dir, 'elsewhere');
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, path.join(dir, 'exports'));
    await expect(saveExport(dir, 'map-abc', { format: 'png', data: PNG })).rejects.toThrow(/symlink/);
  });
});
