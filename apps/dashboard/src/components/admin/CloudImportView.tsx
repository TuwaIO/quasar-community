import './css.css';

import { DefaultTemplate } from '@payloadcms/next/templates';
import { Gutter } from '@payloadcms/ui';
import { notFound } from 'next/navigation';
import type { AdminViewServerProps } from 'payload';

import { EDITION } from '@/constants/edition';

import { CloudImportWizard } from './CloudImportWizard';

/** `/admin/cloud-import`: the import of a Quasar Cloud export (open-source-plans/11 §7.1). Community Edition only. */
export default function CloudImportView({ initPageResult, params, searchParams }: AdminViewServerProps) {
  const { req, locale, permissions, visibleEntities } = initPageResult;
  if (EDITION !== 'community' || !(req.user as { roles?: string[] } | null)?.roles?.includes('admin')) notFound();

  return (
    <DefaultTemplate
      i18n={req.i18n}
      locale={locale}
      params={params}
      payload={req.payload}
      permissions={permissions}
      req={req}
      searchParams={searchParams}
      user={req.user ?? undefined}
      visibleEntities={visibleEntities}
    >
      <Gutter>
        <h1 className="cloud-import__heading">Import data from Quasar Cloud</h1>
        <CloudImportWizard />
      </Gutter>
    </DefaultTemplate>
  );
}
