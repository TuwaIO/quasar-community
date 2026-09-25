export interface ProxyMetadata {
  ownerId: string;
  scopes: string[];
  appId?: string;
  credentialType?: 'public' | 'secret' | 'internal';
}
