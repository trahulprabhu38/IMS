import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateRCA, RCAValidationError } from '../src/patterns/WorkItemState.js';

const base = {
  incidentStart:     '2026-04-30T08:00:00Z',
  incidentEnd:       '2026-04-30T09:30:00Z',
  rootCauseCategory: 'SOFTWARE_BUG',
  fixApplied:        'Rolled back bad deployment',
  preventionSteps:   'Add canary deployment + rollback automation',
};

describe('RCA Validation', () => {
  test('accepts a complete, valid RCA', () => {
    assert.doesNotThrow(() => validateRCA(base));
  });

  test('rejects missing rootCauseCategory', () => {
    assert.throws(() => validateRCA({ ...base, rootCauseCategory: '' }), RCAValidationError);
  });

  test('rejects missing fixApplied', () => {
    assert.throws(() => validateRCA({ ...base, fixApplied: '   ' }), RCAValidationError);
  });

  test('rejects missing preventionSteps', () => {
    assert.throws(() => validateRCA({ ...base, preventionSteps: '' }), RCAValidationError);
  });

  test('rejects incidentEnd equal to incidentStart', () => {
    assert.throws(() => validateRCA({ ...base, incidentEnd: base.incidentStart }), RCAValidationError);
  });

  test('rejects incidentEnd before incidentStart', () => {
    assert.throws(() => validateRCA({ ...base, incidentEnd: '2026-04-29T00:00:00Z' }), RCAValidationError);
  });

  test('rejects undefined incidentStart', () => {
    assert.throws(() => validateRCA({ ...base, incidentStart: undefined }), RCAValidationError);
  });

  test('calculates MTTR correctly (seconds)', () => {
    const start = new Date(base.incidentStart);
    const end   = new Date(base.incidentEnd);
    const mttr  = (end - start) / 1000;
    assert.equal(mttr, 5400); // 90 minutes
  });
});
