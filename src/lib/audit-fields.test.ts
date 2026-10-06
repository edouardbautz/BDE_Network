import { describe, expect, it } from 'vitest';
import { simulationAuditFields } from './audit-fields';

describe('simulationAuditFields', () => {
  it('flags the simulated role, and nothing otherwise', () => {
    expect(simulationAuditFields(null)).toEqual({});
    expect(simulationAuditFields('Trésorier')).toEqual({ simulatedAsRole: 'Trésorier' });
  });

  it('flags the simulated "waiting" status too', () => {
    expect(simulationAuditFields('PENDING')).toEqual({ simulatedAsRole: 'PENDING' });
  });
});
