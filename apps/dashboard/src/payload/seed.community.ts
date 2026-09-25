import type { Payload } from 'payload';

import {
  COMMUNITY_WORKSPACE_QUOTA_BALANCE,
  COMMUNITY_WORKSPACE_RPS_FOREVER,
  COMMUNITY_WORKSPACE_RPS_LIMIT,
} from '@/constants/community';

import { seedAdminUser, seedWorkspace } from './seed';

/**
 * Community edition seed: creates exactly one admin user and their workspace.
 * Deliberately does not seed billing globals, demo Apps, FAQ, or the
 * billing webhook — none of that exists in community edition (see
 * open-source-plans/04-payload-admin-exposure.md, section 4).
 *
 * Unlike prod seed(), this fails loudly instead of skipping: community
 * edition has no self-registration flow, so a missing admin credential
 * would otherwise leave the node with no way to log in at all.
 */
export const seedCommunity = async (payload: Payload): Promise<void> => {
  payload.logger.info('[Seed:Community] Starting community seed...');

  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD?.trim();

  if (!adminEmail || !adminPassword) {
    throw new Error(
      '[Seed:Community] SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set in .env before running the ' +
        'community seed. This is the only account for this node - see .env.example for details.',
    );
  }

  const adminUser = await seedAdminUser(payload, adminEmail, adminPassword);

  // `enforceLimits` is not optional here. Creating the admin above fires
  // `Users.afterChange`, which auto-creates a "Personal Workspace" on the SaaS
  // free-tier defaults (quotaBalance 100, rpsLimit/rpsPaidLimit 5) before this
  // line runs — so without it seedWorkspace finds that org, preserves it, and
  // the community limits below are silently never applied.
  const orgId = await seedWorkspace(payload, adminUser, {
    name: 'Workspace',
    quotaBalance: COMMUNITY_WORKSPACE_QUOTA_BALANCE,
    rpsLimit: COMMUNITY_WORKSPACE_RPS_LIMIT,
    rpsPaidLimit: COMMUNITY_WORKSPACE_RPS_LIMIT,
    enforceLimits: true,
    rpsForever: COMMUNITY_WORKSPACE_RPS_FOREVER,
  });

  payload.logger.info(
    `[Seed:Community] Ready. Admin: ${adminEmail} (User ID: ${adminUser.id}, Workspace ID: ${orgId}).`,
  );
};
