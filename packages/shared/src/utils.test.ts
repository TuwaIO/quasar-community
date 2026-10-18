import { describe, expect, it } from 'vitest';

import { maskEmail } from './utils';

// Logs go to Loki for 7 days: an email address is written there only masked
describe('maskEmail', () => {
  it('keeps the first and last letter of the name and the domain', () => {
    expect(maskEmail('jane.doe@example.com')).toBe('j***e@example.com');
  });

  it('hides a short name completely', () => {
    expect(maskEmail('ab@example.com')).toBe('***@example.com');
  });

  it.each(['not-an-email', '', null, undefined, 'a@b@c'])('hides anything that is not one address (%j)', (value) => {
    expect(maskEmail(value)).toBe('***');
  });
});
