import { init } from '@paralleldrive/cuid2';

/**
 * Initializes a standard CUID2 generator with default settings.
 * Fingerprint and secret are set to provide consistent but secure IDs.
 */
export const createId = init({
  length: 24,
  fingerprint: 'quasar-shared-lib',
});
