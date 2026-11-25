import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ApiSession,
  type E2EState,
  type Persona,
  STATE_FILE,
  createSuperAdminLink,
  newPassword,
  tokenFromMail,
} from './support';

const here = __dirname;

interface Brand {
  id: string;
  slug: string;
}
interface Market {
  id: string;
  brandId: string;
}
interface Branch {
  id: string;
  code: string;
}
interface Role {
  id: string;
  name: string;
}

const COOKIE_NAME = 'matilda_staff';

function storageState(key: string, token: string): string {
  const file = join(here, '.tmp', `${key}.state.json`);
  writeFileSync(
    file,
    JSON.stringify({
      cookies: [
        {
          name: COOKIE_NAME,
          value: token,
          domain: 'localhost',
          path: '/',
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
          expires: -1,
        },
      ],
      origins: [],
    }),
  );
  return file;
}

/** Waits until a mail for `email` has been captured (the API writes it asynchronously). */
async function inviteToken(email: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    try {
      return tokenFromMail(email, 'accept-invite');
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`No invitation mail for ${email}`);
}

/**
 * Prepares one Super Admin, a Branch Manager (one branch), a Catalog Manager (one brand) and a
 * spare sign-in user, all enrolled in 2FA through the same API the screens use.
 */
export default async function globalSetup(): Promise<void> {
  process.env.E2E_PASSWORD = newPassword();
  mkdirSync(join(here, '.tmp'), { recursive: true });
  const runId = Date.now().toString(36);
  const emailOf = (key: string) => `e2e-${key}-${runId}@matilda.test`;

  const adminEmail = emailOf('admin');
  const admin = new ApiSession();
  const adminSecret = await admin.activate(
    createSuperAdminLink(adminEmail, 'E2E Super Admin'),
    adminEmail,
  );

  const brands = (await admin.call('GET', '/admin/brands')) as unknown as Brand[];
  const markets = (await admin.call('GET', '/admin/markets')) as unknown as Market[];
  const branches = (await admin.call('GET', '/admin/branches')) as unknown as Branch[];
  const roles = (await admin.call('GET', '/admin/roles')) as unknown as Role[];
  const flower = brands.find((b) => b.slug === 'matilda-flower');
  const cake = brands.find((b) => b.slug === 'matilda-cake');
  const branch = branches.find((b) => b.code === 'test-branch-dubai');
  const role = (name: string) => roles.find((r) => r.name === name)?.id;
  if (!flower || !cake || !branch)
    throw new Error('The dev seed tier is missing brands or the test branch');
  const flowerMarket = markets.find((m) => m.brandId === flower.id);

  async function staff(
    key: Persona['key'],
    fullName: string,
    roleName: string,
    scope: Record<string, string | null>,
  ) {
    const email = emailOf(key);
    await admin.call('POST', '/admin/staff', {
      email,
      fullName,
      roleId: role(roleName),
      ...scope,
    });
    const session = new ApiSession();
    const secret = await session.activate(await inviteToken(email), email);
    return { email, fullName, secret, token: session.sessionToken() };
  }

  const branchUser = await staff('branch', 'E2E Branch Manager', 'Branch Manager', {
    brandId: flower.id,
    marketId: flowerMarket?.id ?? null,
    branchId: branch.id,
  });
  const catalogUser = await staff('catalog', 'E2E Catalog Manager', 'Catalog Manager', {
    brandId: flower.id,
  });
  const signinUser = await staff('signin', 'E2E Sign-in User', 'Customer Support', {
    brandId: flower.id,
  });

  const personas: E2EState['personas'] = {
    admin: {
      key: 'admin',
      email: adminEmail,
      fullName: 'E2E Super Admin',
      secret: adminSecret,
      storageState: storageState('admin', admin.sessionToken()),
    },
    branch: {
      key: 'branch',
      ...branchUser,
      storageState: storageState('branch', branchUser.token),
    },
    catalog: {
      key: 'catalog',
      ...catalogUser,
      storageState: storageState('catalog', catalogUser.token),
    },
    signin: {
      key: 'signin',
      email: signinUser.email,
      fullName: signinUser.fullName,
      secret: signinUser.secret,
    },
  };
  for (const p of Object.values(personas)) delete (p as unknown as Record<string, unknown>).token;

  const state: E2EState = {
    runId,
    personas,
    brandId: flower.id,
    otherBrandId: cake.id,
    branchId: branch.id,
  };
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
