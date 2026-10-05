import test from 'node:test';
import assert from 'node:assert/strict';
import { pythonExecutable } from './python-runtime.mjs';
test('Python selection is explicit and independent of developer home directories', () => {
  assert.equal(pythonExecutable({}, 'win32'), 'python');
  assert.equal(pythonExecutable({}, 'linux'), 'python3');
  assert.equal(pythonExecutable({ COMPANION_PYTHON: '/tools/python' }), '/tools/python');
  assert.equal(pythonExecutable({ COMPANION_PYTHON: '/tools/python', COMPANION_XLSX_PYTHON: '/xlsx/python' }), '/xlsx/python');
});
