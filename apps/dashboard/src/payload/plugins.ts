import { s3Storage } from '@payloadcms/storage-s3';
import { Plugin } from 'payload';

export const plugins: Plugin[] = [
  s3Storage({
    collections: {
      media: true,
    },
    bucket: process.env.S3_BUCKET_MEDIA || '',
    config: {
      endpoint: process.env.S3_ENDPOINT || '',
      region: process.env.S3_REGION || '',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
      },
      forcePathStyle: true,
    },
  }),
];
