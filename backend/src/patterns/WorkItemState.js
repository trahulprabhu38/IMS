// Functional state machine — no classes, no constructors.
// Error types stay as classes so test instanceof checks still work.

export class InvalidTransitionError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'InvalidTransitionError';
    this.statusCode = 422;
    this.code = 'INVALID_TRANSITION';
  }
}

export class RCAValidationError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'RCAValidationError';
    this.statusCode = 422;
    this.code = 'RCA_VALIDATION';
  }
}

const TRANSITIONS = {
  OPEN:          ['INVESTIGATING'],
  INVESTIGATING: ['RESOLVED'],
  RESOLVED:      ['CLOSED'],
  CLOSED:        [],
};

export function validateRCA(rca) {
  const required = ['rootCauseCategory', 'fixApplied', 'preventionSteps', 'incidentStart', 'incidentEnd'];
  for (const field of required) {
    if (!rca[field] || (typeof rca[field] === 'string' && !rca[field].trim())) {
      throw new RCAValidationError(`RCA field '${field}' is required and cannot be empty`);
    }
  }
  if (new Date(rca.incidentEnd) <= new Date(rca.incidentStart)) {
    throw new RCAValidationError('incidentEnd must be after incidentStart');
  }
}

function createState(status) {
  return {
    getStatus:          () => status,
    allowedTransitions: () => [...(TRANSITIONS[status] || [])],
    transition(targetStatus, rca = null) {
      const allowed = TRANSITIONS[status] || [];
      if (!allowed.includes(targetStatus)) {
        throw new InvalidTransitionError(
          `Cannot transition from ${status} to ${targetStatus}. Allowed: [${allowed.join(', ')}]`
        );
      }
      if (targetStatus === 'CLOSED') {
        if (!rca) throw new RCAValidationError('RCA is required to close a work item');
        validateRCA(rca);
      }
      return createState(targetStatus);
    },
  };
}

// Factory function — no `new` needed at call site
export function stateFromStatus(status) {
  if (!Object.hasOwn(TRANSITIONS, status)) throw new Error(`Unknown status: ${status}`);
  return createState(status);
}

export function validateTransition(currentStatus, targetStatus) {
  const allowed = TRANSITIONS[currentStatus] || [];
  if (!allowed.includes(targetStatus)) {
    throw new InvalidTransitionError(
      `Cannot transition from ${currentStatus} to ${targetStatus}. Allowed: [${allowed.join(', ')}]`
    );
  }
}

export function allowedTransitions(status) {
  return TRANSITIONS[status] || [];
}

// Legacy aliases so existing test imports continue to resolve
export const OpenState          = { create: () => createState('OPEN') };
export const InvestigatingState = { create: () => createState('INVESTIGATING') };
export const ResolvedState      = { create: () => createState('RESOLVED') };
export const ClosedState        = { create: () => createState('CLOSED') };
