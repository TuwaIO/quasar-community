import { createId } from '@tuwaio/shared/cuid';
import { Payload } from 'payload';



/**
 * Idempotent find-or-create for the single admin user. Extracted so that
 * seed.community.ts can reuse this exact logic without duplicating it.
 */
export async function seedAdminUser(payload: Payload, email: string, password: string) {
  const { docs: existingUsers } = await payload.find({
    collection: 'users',
    where: { email: { equals: email } },
    limit: 1,
  });

  let adminUser = existingUsers[0];
  if (!adminUser) {
    payload.logger.info(`[Seed] Creating Admin User: ${email}...`);
    adminUser = await payload.create({
      collection: 'users',
      data: {
        email,
        password,
        name: 'Admin',
        roles: ['admin'],
        _verified: true,
      } as any,
    });
  } else {
    payload.logger.info(`[Seed] Admin User ${email} already exists (ID: ${adminUser.id}). Preserving.`);
  }

  return adminUser;
}

export interface SeedWorkspaceOptions {
  name?: string;
  quotaBalance?: number;
  rpsLimit?: number;
  rpsPaidLimit?: number;
  /**
   * Raise an *existing* workspace to the requested limits instead of leaving
   * it exactly as found, and pin `rpsForever`.
   *
   * Off by default, because the prod seed's contract (guarantee 3 above) is
   * that it never touches a live quota. Community edition needs the opposite:
   * `Users.afterChange` auto-creates a "Personal Workspace" the instant
   * `seedAdminUser` inserts the admin — with the SaaS free-tier defaults
   * (quotaBalance 100, rpsLimit/rpsPaidLimit 5) — so by the time this function
   * runs there is *always* an existing org and the community limits below
   * never reached the database. That is the bug this flag closes.
   *
   * Strictly a floor: a value already above the target is left alone, so an
   * operator who raised a limit by hand does not get it reset on the next
   * deploy, and re-running the seed stays idempotent.
   */
  enforceLimits?: boolean;
  /** Pin the RPS limit so it never expires. Only applied with `enforceLimits`. */
  rpsForever?: boolean;
}

/**
 * Idempotent find-or-create for the admin's workspace organization. Extracted
 * so that seed.community.ts can reuse this exact logic without duplicating it.
 * Defaults match the historical prod seed values exactly (name "TUWA Team" ->
 * slug prefix "tuwa-team", quotaBalance 1000000, rpsLimit/rpsPaidLimit 100).
 */
export async function seedWorkspace(payload: Payload, adminUser: any, options: SeedWorkspaceOptions = {}) {
  const { docs: orgs } = await payload.find({
    collection: 'organizations',
    where: { createdBy: { equals: adminUser.id } },
    limit: 1,
  });

  const { name = 'TUWA Team', quotaBalance = 1000000, rpsLimit = 100, rpsPaidLimit = 100 } = options;

  if (orgs.length > 0) {
    const existing = orgs[0];

    if (!options.enforceLimits) {
      payload.logger.info(`[Seed] Found existing workspace: ${existing.id}. Preserving quota and balance.`);
      return existing.id as string | number;
    }

    // Floor semantics: only ever raise. See `enforceLimits` above.
    const patch: Record<string, unknown> = {};
    if ((existing.quotaBalance ?? 0) < quotaBalance) patch.quotaBalance = quotaBalance;
    if ((existing.rpsLimit ?? 0) < rpsLimit) patch.rpsLimit = rpsLimit;
    if ((existing.rpsPaidLimit ?? 0) < rpsPaidLimit) patch.rpsPaidLimit = rpsPaidLimit;
    if (options.rpsForever && existing.rpsForever !== true) patch.rpsForever = true;

    if (Object.keys(patch).length === 0) {
      payload.logger.info(`[Seed] Existing workspace ${existing.id} already meets the configured limits.`);
      return existing.id as string | number;
    }

    payload.logger.info(
      `[Seed] Raising existing workspace ${existing.id} to the configured limits: ${JSON.stringify(patch)}`,
    );
    // overrideAccess is required: quotaBalance, rpsLimit, rpsPaidLimit and
    // rpsForever are all admin-only at field level (isAdminFieldLevel), and the
    // seed runs with no user on the request at all.
    await payload.update({
      collection: 'organizations',
      id: existing.id as string,
      data: patch as any,
      overrideAccess: true,
      context: { skipAuthCheck: true },
    });

    return existing.id as string | number;
  }

  payload.logger.info('[Seed] Creating default workspace for Admin...');
  const manualOrg = await payload.create({
    collection: 'organizations',
    data: {
      name,
      slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${createId().slice(0, 6)}`,
      createdBy: adminUser.id,
      quotaBalance,
      rpsLimit,
      rpsPaidLimit,
      quotaUsed: 0,
      ...(options.enforceLimits && options.rpsForever ? { rpsForever: true } : {}),
    },
    context: { skipAuthCheck: true },
  } as any);

  return manualOrg.id as string | number;
}
