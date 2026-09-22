import assert from 'node:assert/strict';
import { test } from 'node:test';
import { A2 } from './print.ts';

test('A2 export has true 300-DPI pixel dimensions', () => {
  assert.equal(A2.widthPx, 4961);
  assert.equal(A2.heightPx, 7016);
  assert.equal(A2.widthMm, 420);
  assert.equal(A2.heightMm, 594);
});
