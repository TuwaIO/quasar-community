import { QUOTA_DEFAULTS } from '@tuwaio/shared/constants';

const cleanEnv = (val?: string) => (val ? val.replace(/^['"]|['"]$/g, '') : undefined);

export const FROM_EMAIL = cleanEnv(process.env.FROM_EMAIL) || 'noreply@mail.example.com';
export const RP_NAME = cleanEnv(process.env.RP_NAME) || 'TUWA | Quasar';
export const RP_ID = cleanEnv(process.env.RP_ID) || 'localhost';
export const SERVER_URL = cleanEnv(process.env.NEXT_PUBLIC_SERVER_URL) || 'http://localhost:3000';
export const ALCHEMY_KEY = cleanEnv(process.env.ALCHEMY_API_KEY) || '';
export const ENGINE_URL = cleanEnv(process.env.NEXT_PUBLIC_ENGINE_URL) || 'http://localhost:3001';

export const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@example.com';

export const TOTP_CODE_LENGTH = 6;
export const DISCORD_SUPPORT_LINK = 'https://discord.gg/MAwrgB48ZM';
export const MAX_LOGIN_ATTEMPTS = parseInt(process.env.MAX_LOGIN_ATTEMPTS ?? '5');

/** Shared toast configuration for the Quasar Dashboard */
export const TOAST_CONTAINER_ID = 'quasar-dashboard';

export const TX_TYPE_TOOLTIP =
  'Mandatory field specifying the transaction type you used when generating the transaction in your interface.';

export const getQuotaPerTx = () => {
  if (typeof process === 'undefined') return QUOTA_DEFAULTS.SYNC_TX_WEIGHT;
  return Number(QUOTA_DEFAULTS.SYNC_TX_WEIGHT);
};
