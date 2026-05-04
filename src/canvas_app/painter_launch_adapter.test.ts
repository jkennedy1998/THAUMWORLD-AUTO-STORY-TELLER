function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

(globalThis as any).window = {
  electronAPI: {},
  localStorage: {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  },
};

const { resolve_open_dialog_first_path } = await import('./painter_launch_adapter.js');

assert(
  resolve_open_dialog_first_path({ success: true, result: { filePaths: ['C:/tmp/example.json'] } }) === 'C:/tmp/example.json',
  'should read wrapped electron dialog response path',
);
assert(
  resolve_open_dialog_first_path({ filePaths: ['C:/tmp/legacy.json'] }) === 'C:/tmp/legacy.json',
  'should still read direct filePaths for compatibility',
);
assert(resolve_open_dialog_first_path(null) === null, 'should return null when dialog response is empty');

console.log('painter_launch_adapter tests passed');
