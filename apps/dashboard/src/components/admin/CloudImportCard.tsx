import './css.css';

import Link from 'next/link';
import type { ServerProps } from 'payload';

import { EDITION } from '@/constants/edition';

/**
 * "Import data from Quasar Cloud" on the admin dashboard (`admin.components.beforeDashboard`). Registered in both
 * editions so they share one import map; renders only on a Community Edition node, for its admin.
 */
export default function CloudImportCard({ payload, user }: ServerProps) {
  if (EDITION !== 'community' || !(user as { roles?: string[] } | undefined)?.roles?.includes('admin')) return null;
  const href = `${payload.config.routes.admin}/cloud-import`;

  return (
    <div className="cloud-import-card">
      <div>
        <h3 className="cloud-import-card__title">Import data from Quasar Cloud</h3>
        <p className="cloud-import-card__text">
          Move an organization from Quasar Cloud to this node: its apps with their API keys, webhook endpoints with
          their signing secrets and its transaction history. Export it on the organization page in Quasar Cloud first.
        </p>
      </div>
      <Link href={href} className="btn btn--style-primary btn--size-medium cloud-import-card__button">
        Import data from Cloud
      </Link>
    </div>
  );
}
