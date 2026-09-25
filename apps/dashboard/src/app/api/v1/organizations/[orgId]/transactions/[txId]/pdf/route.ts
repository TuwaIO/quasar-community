import { generate } from '@pdfme/generator';
import { image, line, text } from '@pdfme/schemas';
import { getChainName } from '@tuwaio/sdk/nova-core';
import fs from 'fs';
import { NextResponse } from 'next/server';
import path from 'path';

import transactionTemplate from '@/constants/transaction-receipt-template.json';
import { withRateLimit } from '@/lib/apiWrapper';
import { authenticateRequest, verifyOrgAccessOrSystemAdmin } from '@/lib/auth-utils';
import { formatTimestamp } from '@/lib/formatTimestamp';
import type { Transaction } from '@/payload-types';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safely convert any value to a string. pdfme crashes on non-strings. */
const str = (v: unknown): string => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const GET = withRateLimit(
  async (req: Request, { params }: { params: Promise<{ orgId: string; txId: string }> }) => {
    try {
      const { orgId, txId } = await params;
      const auth = await authenticateRequest(req);
      if (auth instanceof NextResponse) return auth;
      const { payload, user } = auth;

      const access = await verifyOrgAccessOrSystemAdmin(payload, user, orgId, ['owner', 'admin', 'member']);
      if (access instanceof NextResponse) return access;

      const transaction = await payload.findByID({
        collection: 'transactions',
        id: txId,
        depth: 1,
        overrideAccess: true,
        context: { skipOwnerFilter: true },
      });

      if (
        !transaction ||
        (typeof transaction.owner === 'object' ? transaction.owner.id : transaction.owner) !== orgId
      ) {
        return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
      }

      const tx = transaction as unknown as Transaction;

      // -------------------------------------------------------------------
      // Build inputs — EVERY value MUST be a string.
      // Keys must match schema names in transaction-receipt-template.json.
      // -------------------------------------------------------------------
      const chainName = (() => {
        try {
          return getChainName(parseInt(tx.chainId)).name;
        } catch {
          return tx.chainId;
        }
      })();

      const inputs: Record<string, string> = {
        // Header
        txId: `Internal ID: ${str(tx.id)}`,
        date: `Generated: ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'medium' })}`,

        // Status
        status: tx.pending ? 'PENDING' : tx.status?.toUpperCase() || 'FAILED',

        // Core
        type: str(tx.type),
        adapter: str(tx.adapter).toUpperCase(),
        network: `${chainName} (ID: ${tx.chainId})`,
        hash: str(tx.hash || tx.txKey),
        from: str(tx.from),
        to: str(tx.to),
        value: str(tx.value || '0'),

        // Timestamps
        submittedAt: formatTimestamp(tx.localTimestamp) || '—',
        finishedAt: formatTimestamp(tx.finishedTimestamp) || '—',

        // Execution
        tracker: str(tx.tracker).toUpperCase(),
        connector: str(tx.connectorType).toUpperCase(),
        nonce: str(tx.nonce),
        fee: str(tx.fee),
        maxFee: str(tx.maxFeePerGas),
        maxPriority: str(tx.maxPriorityFeePerGas),
        slot: str(tx.slot),
        confirmations: str(tx.confirmations),
        replacedTxHash: str(tx.replacedTxHash),
        contractAddress: str(tx.contractAddress),

        // Application
        appName: str(tx.appName),
        txKey: str(tx.txKey),
      };

      // -------------------------------------------------------------------
      // Font loading
      // -------------------------------------------------------------------
      let regularFont: Buffer | undefined;
      try {
        const ubuntuDir = path.join(process.cwd(), 'public/fonts/ubuntu');
        regularFont = fs.readFileSync(path.join(ubuntuDir, 'Ubuntu-R.ttf'));
      } catch {
        console.warn('[PDF] Ubuntu fonts not found, falling back to defaults');
      }

      const font = regularFont ? { Roboto: { data: new Uint8Array(regularFont) as any, fallback: true } } : undefined;

      // -------------------------------------------------------------------
      // Generate
      // -------------------------------------------------------------------
      const pdfBuffer = await generate({
        template: transactionTemplate as any,
        inputs: [inputs],
        options: font ? { font } : undefined,
        plugins: { text, image, line },
      });

      return new Response(pdfBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="RECEIPT-${tx.id}.pdf"`,
          'Cache-Control': 'no-store',
        },
      });
    } catch (error) {
      console.error('[Transaction PDF Generation] Error:', error);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  },
);
