import crypto from 'crypto';

import { executeRedisSafe, redis } from '@/lib/redis';

// ── Redis Key Constants ──────────────────────────────────────────────────────

const AML_TOKEN_KEY = 'quasar:aml:token';
const AML_TOKEN_TTL = 1800; // 30 minutes
const AML_CACHE_TTL = 21600; // 6 hours

const getAmlCacheKey = (chainId: string, address: string) => `quasar:aml:cache:${chainId}:${address.toLowerCase()}`;

// ── GoPlus API Response Types ────────────────────────────────────────────────

interface GoPlusTokenResponse {
  code: number;
  message: string;
  result: {
    access_token: string;
    expires_in: number;
  };
}

interface GoPlusScanResultData {
  cybercrime: string;
  money_laundering: string;
  phishing_activities: string;
  darknet_market: string;
  financial_crime: string;
  blacklist_doubt: string;
  data_source: string;
}

interface GoPlusScanResponse {
  code: number;
  message: string;
  result: GoPlusScanResultData;
}

// ── Public Report Type ───────────────────────────────────────────────────────

export interface ScannedAddressReport {
  isSuccess: boolean;
  address: string;
  isHighRisk: boolean;
  signals: {
    isCybercrime: boolean;
    isMoneyLaundering: boolean;
    isPhishing: boolean;
    isDarknet: boolean;
    isSanctioned: boolean;
    isBlacklisted: boolean;
  };
  dataSource: string;
}

// ── GoPlus Token Acquisition ─────────────────────────────────────────────────

/**
 * Obtains an access token from GoPlus API.
 * Sign = SHA1(app_key + unix_timestamp + app_secret)
 */
async function getGoPlusToken(appKey: string, appSecret: string): Promise<string> {
  const time = Math.floor(Date.now() / 1000);
  const signString = appKey + time + appSecret;
  const sign = crypto.createHash('sha1').update(signString).digest('hex');

  console.info(`[AML_SERVICE] Token Request Data:`);
  console.info(`  - app_key: [MASKED]`);
  console.info(`  - time: ${time}`);
  console.info(`  - signString base: [MASKED]`);
  console.info(`  - sign: [MASKED]`);

  const response = await fetch('https://api.gopluslabs.io/api/v1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ app_key: appKey, time, sign }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[AML_SERVICE] Token HTTP Error: ${response.status}. Body: ${errorText}`);
    throw new Error(`GoPlus Token HTTP Error: ${response.status}`);
  }

  const data = (await response.json()) as GoPlusTokenResponse;
  console.info(`[AML_SERVICE] Token Response Code: ${data.code}, Msg: ${data.message}`);

  if (data.code !== 1 || !data.result?.access_token) {
    throw new Error(`GoPlus Token API Error: ${data.message || 'Failed to obtain token'}`);
  }

  return data.result.access_token;
}

// ── GoPlus Address Scan ──────────────────────────────────────────────────────

/**
 * Scans a wallet address for AML risk signals via GoPlus API.
 * Requires a valid Bearer token from getGoPlusToken() and app_key in query/header.
 */
async function goPlusAddressScan(
  accessToken: string,
  walletAddress: string,
  chainId: string,
  appKey: string,
): Promise<ScannedAddressReport> {
  // Use both query param and app-key header for maximum compatibility with commercial accounts
  const url = `https://api.gopluslabs.io/api/v1/address/scan/${chainId}?address=${walletAddress}&app_key=${appKey}`;

  const authHeader = accessToken.startsWith('Bearer ') ? accessToken : `Bearer ${accessToken}`;

  const maskedAppKey = appKey.length > 8 ? `${appKey.slice(0, 4)}...${appKey.slice(-4)}` : '***';
  console.info(`[AML_SERVICE] Scanning address: ${walletAddress} on chain: ${chainId}`);
  console.info(
    `[AML_SERVICE] Request URL: https://api.gopluslabs.io/api/v1/address/scan/${chainId}?address=${walletAddress}&app_key=${maskedAppKey}`,
  );
  console.info(`[AML_SERVICE] Headers: { Authorization: [MASKED], app-key: ${maskedAppKey} }`);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: authHeader,
      'app-key': appKey,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[AML_SERVICE] Scan HTTP Error: ${response.status}. Body: ${errorText}`);
    throw new Error(`GoPlus Scan HTTP Error: ${response.status}`);
  }

  const data = (await response.json()) as GoPlusScanResponse;
  console.info(`[AML_SERVICE] Scan Response Code: ${data.code}, Msg: ${data.message}`);

  if (data.code !== 1 || !data.result) {
    throw new Error(`GoPlus Scan API Error: ${data.message || 'Unknown error'}`);
  }

  const res = data.result;

  return {
    isSuccess: true,
    address: walletAddress,
    signals: {
      isCybercrime: res.cybercrime === '1',
      isMoneyLaundering: res.money_laundering === '1',
      isPhishing: res.phishing_activities === '1',
      isDarknet: res.darknet_market === '1',
      isSanctioned: res.financial_crime === '1',
      isBlacklisted: res.blacklist_doubt === '1',
    },
    isHighRisk: [
      res.cybercrime,
      res.money_laundering,
      res.phishing_activities,
      res.financial_crime,
      res.darknet_market,
    ].some((signal) => signal === '1'),
    dataSource: res.data_source || 'GoPlus',
  };
}

// ── Cached Token Resolution ──────────────────────────────────────────────────

/**
 * Resolves a GoPlus access token, using Redis as a TTL-backed cache.
 */
async function resolveGoPlusToken(appKey: string, appSecret: string): Promise<string> {
  try {
    const cached = await executeRedisSafe(redis.get(AML_TOKEN_KEY), 2000, 'AML:TokenCache:GET');
    if (cached) {
      console.info('[AML_SERVICE] Token cache hit');
      return cached;
    }
    console.info('[AML_SERVICE] Token cache miss');
  } catch (err: unknown) {
    console.warn(`[AML_SERVICE] Redis GET token failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }

  const token = await getGoPlusToken(appKey, appSecret);

  try {
    await executeRedisSafe(redis.set(AML_TOKEN_KEY, token, 'EX', AML_TOKEN_TTL), 2000, 'AML:TokenCache:SET');
    console.info('[AML_SERVICE] Token cached in Redis');
  } catch (err: unknown) {
    console.warn(`[AML_SERVICE] Redis SET token failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }

  return token;
}

// ── Public API: Cached AML Check ─────────────────────────────────────────────

export async function checkAmlWithCache(walletAddress: string, chainId: string): Promise<ScannedAddressReport> {
  const appKey = process.env.GOPLUS_APP_KEY?.trim();
  const appSecret = process.env.GOPLUS_APP_SECRET?.trim();

  if (!appKey || !appSecret) {
    console.error('[AML_SERVICE] Environment variables missing or empty: GOPLUS_APP_KEY or GOPLUS_APP_SECRET');
    throw new Error('AML Service configuration missing');
  }

  // Map Sepolia (11155111) to Mainnet (1) for GoPlus scanning
  const SEPOLIA_ID = '11155111';
  const effectiveChainId = chainId === SEPOLIA_ID ? '1' : chainId;

  if (chainId === SEPOLIA_ID) {
    console.info(`[AML_SERVICE] Mapping Sepolia (${SEPOLIA_ID}) to Mainnet (1) for address: ${walletAddress}`);
  }

  // Debug: check for obvious swaps (key is usually shorter than secret)
  if (appKey.length > appSecret.length) {
    console.warn('[AML_SERVICE] Warning: appKey is longer than appSecret. Are they swapped?');
  }

  const cacheKey = getAmlCacheKey(effectiveChainId, walletAddress);

  try {
    const cachedResult = await executeRedisSafe(redis.get(cacheKey), 2000, 'AML:ResultCache:GET');
    if (cachedResult) {
      const parsed: unknown = JSON.parse(cachedResult);
      if (isScannedAddressReport(parsed)) {
        console.info(`[AML_SERVICE] Result cache hit for ${walletAddress}`);
        return parsed;
      }
    }
  } catch (err: unknown) {
    console.warn(`[AML_SERVICE] Redis GET result failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }

  const accessToken = await resolveGoPlusToken(appKey, appSecret);
  const report = await goPlusAddressScan(accessToken, walletAddress, effectiveChainId, appKey);

  try {
    await executeRedisSafe(
      redis.set(cacheKey, JSON.stringify(report), 'EX', AML_CACHE_TTL),
      2000,
      'AML:ResultCache:SET',
    );
    console.info(`[AML_SERVICE] Result cached for ${walletAddress}`);
  } catch (err: unknown) {
    console.warn(`[AML_SERVICE] Redis SET result failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }

  return report;
}

// ── Type Guard ───────────────────────────────────────────────────────────────

function isScannedAddressReport(value: unknown): value is ScannedAddressReport {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.isSuccess === 'boolean' && typeof obj.isHighRisk === 'boolean' && typeof obj.address === 'string';
}
