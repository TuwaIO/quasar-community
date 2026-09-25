import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { decrypt } from '@tuwaio/shared/encryption';
import * as crypto from 'crypto';
import { Redis } from 'ioredis';

import { REDIS } from '../redis/redis.module';

const AML_TOKEN_KEY = 'quasar:aml:token';
const AML_TOKEN_TTL = 1800; // 30 minutes
const AML_CACHE_TTL = 21600; // 6 hours

const getAmlCacheKey = (chainId: string, address: string) => `quasar:aml:cache:${chainId}:${address.toLowerCase()}`;

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

@Injectable()
export class AmlService {
  private readonly logger = new Logger(AmlService.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Obtains an access token from GoPlus API.
   * Sign = SHA1(app_key + unix_timestamp + app_secret)
   */
  private async getGoPlusToken(appKey: string, appSecret: string): Promise<string> {
    const time = Math.floor(Date.now() / 1000);
    const signString = appKey + time + appSecret;
    const sign = crypto.createHash('sha1').update(signString).digest('hex');

    const response = await fetch('https://api.gopluslabs.io/api/v1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ app_key: appKey, time, sign }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`Token HTTP Error: ${response.status}. Body: ${errorText}`);
      throw new Error(`GoPlus Token HTTP Error: ${response.status}`);
    }

    const data = (await response.json()) as GoPlusTokenResponse;

    if (data.code !== 1 || !data.result?.access_token) {
      throw new Error(`GoPlus Token API Error: ${data.message || 'Failed to obtain token'}`);
    }

    return data.result.access_token;
  }

  /**
   * Resolves a GoPlus access token, using Redis as a TTL-backed cache.
   */
  private async resolveGoPlusToken(appKey: string, appSecret: string): Promise<string> {
    try {
      const cached = await this.redis.get(AML_TOKEN_KEY);
      if (cached) {
        return cached;
      }
    } catch (err: unknown) {
      this.logger.warn(`Redis GET token failed: ${err instanceof Error ? err.message : err}`);
    }

    const token = await this.getGoPlusToken(appKey, appSecret);

    try {
      await this.redis.set(AML_TOKEN_KEY, token, 'EX', AML_TOKEN_TTL);
    } catch (err: unknown) {
      this.logger.warn(`Redis SET token failed: ${err instanceof Error ? err.message : err}`);
    }

    return token;
  }

  /**
   * Scans a wallet address for AML risk signals via GoPlus API.
   */
  private async goPlusAddressScan(
    accessToken: string,
    walletAddress: string,
    chainId: string,
    appKey: string,
  ): Promise<ScannedAddressReport> {
    const url = `https://api.gopluslabs.io/api/v1/address/scan/${chainId}?address=${walletAddress}&app_key=${appKey}`;
    const authHeader = accessToken.startsWith('Bearer ') ? accessToken : `Bearer ${accessToken}`;

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
      this.logger.error(`Scan HTTP Error: ${response.status}. Body: ${errorText}`);
      throw new Error(`GoPlus Scan HTTP Error: ${response.status}`);
    }

    const data = (await response.json()) as GoPlusScanResponse;

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

  /**
   * Public API: Performs AML check with Redis caching
   */
  async checkAml(
    walletAddress: string,
    chainId: string,
    customApiKey?: string | null,
    customApiSecret?: string | null,
  ): Promise<ScannedAddressReport> {
    // Decrypt keys if custom credentials are provided
    let appKey = customApiKey ? decrypt(customApiKey) : null;
    let appSecret = customApiSecret ? decrypt(customApiSecret) : null;

    if (!appKey || !appSecret) {
      // Fall back to system credentials (FALLBACK_GOPLUS_APP_KEY first, then standard GOPLUS_APP_KEY)
      appKey =
        this.configService.get<string>('FALLBACK_GOPLUS_APP_KEY') ||
        this.configService.get<string>('GOPLUS_APP_KEY') ||
        null;
      appSecret =
        this.configService.get<string>('FALLBACK_GOPLUS_APP_SECRET') ||
        this.configService.get<string>('GOPLUS_APP_SECRET') ||
        null;
    }

    if (!appKey || !appSecret) {
      this.logger.error('AML configuration missing. Neither custom credentials nor fallback/system keys are set.');
      throw new Error('AML Service configuration missing');
    }

    // Map Sepolia (11155111) to Mainnet (1) for GoPlus scanning
    const SEPOLIA_ID = '11155111';
    const effectiveChainId = chainId === SEPOLIA_ID ? '1' : chainId;

    const cacheKey = getAmlCacheKey(effectiveChainId, walletAddress);

    try {
      const cachedResult = await this.redis.get(cacheKey);
      if (cachedResult) {
        const parsed = JSON.parse(cachedResult);
        if (this.isScannedAddressReport(parsed)) {
          return parsed;
        }
      }
    } catch (err: unknown) {
      this.logger.warn(`Redis GET result failed: ${err instanceof Error ? err.message : err}`);
    }

    const accessToken = await this.resolveGoPlusToken(appKey, appSecret);
    const report = await this.goPlusAddressScan(accessToken, walletAddress, effectiveChainId, appKey);

    try {
      await this.redis.set(cacheKey, JSON.stringify(report), 'EX', AML_CACHE_TTL);
    } catch (err: unknown) {
      this.logger.warn(`Redis SET result failed: ${err instanceof Error ? err.message : err}`);
    }

    return report;
  }

  private isScannedAddressReport(value: unknown): value is ScannedAddressReport {
    if (typeof value !== 'object' || value === null) return false;
    const obj = value as Record<string, unknown>;
    return typeof obj.isSuccess === 'boolean' && typeof obj.isHighRisk === 'boolean' && typeof obj.address === 'string';
  }
}
