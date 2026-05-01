import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  stateFromStatus,
  InvalidTransitionError,
  RCAValidationError,
} from '../src/patterns/WorkItemState.js';

const validRCA = {
  incidentStart:     '2026-04-30T09:00:00Z',
  incidentEnd:       '2026-04-30T10:00:00Z',
  rootCauseCategory: 'INFRASTRUCTURE',
  fixApplied:        'Restarted primary DB and ran failover',
  preventionSteps:   'Add automated failover and alerting',
};

describe('State Machine — valid transitions', () => {
  test('OPEN → INVESTIGATING', () => {
    const next = stateFromStatus('OPEN').transition('INVESTIGATING');
    assert.equal(next.getStatus(), 'INVESTIGATING');
  });

  test('INVESTIGATING → RESOLVED', () => {
    const next = stateFromStatus('INVESTIGATING').transition('RESOLVED');
    assert.equal(next.getStatus(), 'RESOLVED');
  });

  test('RESOLVED → CLOSED with complete RCA', () => {
    const next = stateFromStatus('RESOLVED').transition('CLOSED', validRCA);
    assert.equal(next.getStatus(), 'CLOSED');
  });
});

describe('State Machine — invalid transitions', () => {
  test('OPEN → RESOLVED throws', () => {
    assert.throws(
      () => stateFromStatus('OPEN').transition('RESOLVED'),
      InvalidTransitionError
    );
  });

  test('CLOSED → INVESTIGATING throws', () => {
    assert.throws(
      () => stateFromStatus('CLOSED').transition('INVESTIGATING'),
      InvalidTransitionError
    );
  });

  test('RESOLVED → CLOSED without RCA throws RCAValidationError', () => {
    assert.throws(
      () => stateFromStatus('RESOLVED').transition('CLOSED', null),
      RCAValidationError
    );
  });

  test('RESOLVED → CLOSED with missing fixApplied throws', () => {
    assert.throws(
      () => stateFromStatus('RESOLVED').transition('CLOSED', { ...validRCA, fixApplied: '' }),
      RCAValidationError
    );
  });

  test('RESOLVED → CLOSED when end <= start throws', () => {
    assert.throws(
      () => stateFromStatus('RESOLVED').transition('CLOSED', { ...validRCA, incidentEnd: validRCA.incidentStart }),
      RCAValidationError
    );
  });
});

describe('stateFromStatus', () => {
  test('returns state with correct status', () => {
    assert.equal(stateFromStatus('OPEN').getStatus(), 'OPEN');
    assert.equal(stateFromStatus('CLOSED').getStatus(), 'CLOSED');
  });

  test('throws on unknown status', () => {
    assert.throws(() => stateFromStatus('UNKNOWN'), Error);
  });
});
