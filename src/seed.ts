import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';

async function main() {
  if (process.env.ALLOW_DEMO_SEED !== 'true') {
    throw new Error('Demo seed requires ALLOW_DEMO_SEED=true');
  }

  const password = process.env.DEMO_PASSWORD;
  if (!password || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('Set DEMO_PASSWORD: at least 12 characters, at most 72 UTF-8 bytes');
  }

  const db = new PrismaClient();
  try {
    const passwordHash = await hash(password, 12);
    for (const email of ['alice@example.com', 'bob@example.com']) {
      await db.user.upsert({
        where: { email },
        update: {},
        create: {
          email,
          passwordHash,
          account: { create: { balance: 100000n } },
        },
      });
    }
    console.log('Demo users are available: alice@example.com, bob@example.com');
    console.log('Existing users, passwords and balances were not reset.');
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
