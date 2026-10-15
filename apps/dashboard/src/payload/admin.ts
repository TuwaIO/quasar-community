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
    // Monaco of the code editor from this site, not from jsDelivr (Cookie and Privacy policies)
    providers: ['@/components/admin/MonacoLocalProvider#MonacoLocalProvider'],
    // Import of a Cloud export. Registered in both editions so they share one import map: the components render
    // only on a Community Edition node (constants/edition.ts)
    beforeDashboard: ['@/components/admin/CloudImportCard'],
    views: {
      login: {
        Component: '@/components/admin/CustomLogin',
        path: '/login' as const,
      },
      cloudImport: {
        Component: '@/components/admin/CloudImportView',
        path: '/cloud-import' as const,
        meta: { title: 'Import from Cloud' },
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
