import path from 'path';
import { Config } from 'payload';
import { fileURLToPath } from 'url';

import { Users } from '@/collections/ContextUsers/Users';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

export const adminConfig: Config['admin'] = {
  user: Users.slug,
  // Payload's built-in account picture: its default comes from a third-party avatar service, which would get the hash
  // of every operator's email address and their IP address (Cookie and Privacy policies)
  avatar: 'default',
  importMap: {
    baseDir: path.resolve(dirname, '..'),
  },
  components: {
    // Monaco of the code editor from this site, not from jsDelivr (Cookie and Privacy policies)
    // The theme cookie of the admin panel is kept 30 days after the choice (Cookie Policy)
    providers: [
      '@/components/admin/MonacoLocalProvider#MonacoLocalProvider',
      '@/components/admin/AdminThemeCookieLimit#AdminThemeCookieLimit',
    ],
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
