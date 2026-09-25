import '../styles/globals.css';

import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';

import { Button } from '@/components/ui/Button';
import { UI_TEXT } from '@/constants/ui-text';

export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-[var(--tuwa-bg-primary)] px-4 text-center">
          <div className="mb-6 rounded-full bg-[var(--tuwa-bg-secondary)] p-6 shadow-sm border border-[var(--tuwa-border-primary)]">
            <ExclamationTriangleIcon className="h-12 w-12 text-[var(--tuwa-text-tertiary)]" />
          </div>
          <h2 className="mb-2 text-3xl font-black text-[var(--tuwa-text-primary)]">{UI_TEXT.PAGES.NOT_FOUND.TITLE}</h2>
          <p className="mb-8 max-w-md text-[var(--tuwa-text-secondary)]">{UI_TEXT.PAGES.NOT_FOUND.DESCRIPTION}</p>
          <a href="/">
            <Button size="lg" className="min-w-[200px]">
              {UI_TEXT.PAGES.NOT_FOUND.RETURN_HOME_BUTTON}
            </Button>
          </a>
        </div>
      </body>
    </html>
  );
}
