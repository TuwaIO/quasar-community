import path from 'path';
import { Config } from 'payload';
import { fileURLToPath } from 'url';

import { Users } from '@/collections/ContextUsers/Users';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

export const adminConfig: Config['admin'] = {
  user: Users.slug,
  importMap: {
    baseDir: path.resolve(dirname, '..'),
  },
  components: {
    views: {
      login: {
        Component: '@/components/admin/CustomLogin',
        path: '/login' as const,
      },
    },
  },
  meta: {
    icons: [
      {
        rel: 'icon',
        type: 'image/x-icon',
        url: '/favicon.ico',
      },
      {
        rel: 'apple-touch-icon',
        type: 'image/png',
        url: '/apple-touch-icon.png',
      },
    ],
  },
};
