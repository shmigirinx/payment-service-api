import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/app';
import { PrismaService } from '../src/prisma';

describe('Payment API with real PostgreSQL', () => {
  let app: INestApplication;
  let db: PrismaService;
  let alice: { accessToken: string; accountId: string };
  let bob: { accessToken: string; accountId: string };
  const password = 'test-password-12345';

  const send = (key: string, amount: unknown = '100') =>
    request(app.getHttpServer())
      .post('/transfers')
      .auth(alice.accessToken, { type: 'bearer' })
      .set('Idempotency-Key', key)
      .send({ recipientAccountId: bob.accountId, amount });

  const balance = async (id: string) =>
    (await db.account.findUniqueOrThrow({ where: { id } })).balance;

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    const name = decodeURIComponent(url.pathname.slice(1));
    if (!name.endsWith('_test')) {
      throw new Error('Tests require a dedicated database ending in _test');
    }
    app = await createApp();
    await app.init();
    db = app.get(PrismaService);
  });

  beforeEach(async () => {
    await db.transfer.deleteMany();
    await db.account.deleteMany();
    await db.user.deleteMany();

    const a = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'alice@example.com', password })
      .expect(201);
    const b = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'bob@example.com', password })
      .expect(201);

    alice = a.body;
    bob = b.body;
    await db.account.update({
      where: { id: alice.accountId },
      data: { balance: 1000n },
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('registers an empty account, normalizes email and supports login', async () => {
    const registration = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: ' Carol@Example.com ', password })
      .expect(201);

    expect(await balance(registration.body.accountId)).toBe(0n);

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'carol@example.com', password })
      .expect(409);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'carol@example.com', password })
      .expect(200);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'carol@example.com', password: 'incorrect-password' })
      .expect(401);
  });

  it('requires JWT and returns only the current account', async () => {
    await request(app.getHttpServer()).get('/accounts/me').expect(401);
    const own = await request(app.getHttpServer())
      .get('/accounts/me')
      .auth(alice.accessToken, { type: 'bearer' })
      .expect(200);
    expect(own.body).toEqual({
      id: alice.accountId, balance: '1000', currency: 'RUB',
    });
  });

  it('transfers funds and preserves the total balance', async () => {
    const result = await send('success').expect(201);
    expect(result.body.amount).toBe('100');
    expect(await balance(alice.accountId)).toBe(900n);
    expect(await balance(bob.accountId)).toBe(100n);
    expect(await db.transfer.count()).toBe(1);
  });

  it('rolls back insufficient funds', async () => {
    await send('insufficient', '1001').expect(400);
    expect(await balance(alice.accountId)).toBe(1000n);
    expect(await balance(bob.accountId)).toBe(0n);
    expect(await db.transfer.count()).toBe(0);
  });

  it('replays a key and rejects changed content', async () => {
    const first = await send('repeat').expect(201);
    const second = await send('repeat').expect(201);
    expect(second.body).toEqual(first.body);
    await send('repeat', '200').expect(409);
    expect(await balance(alice.accountId)).toBe(900n);
    expect(await db.transfer.count()).toBe(1);
  });

  it('creates one transfer for simultaneous identical requests', async () => {
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => send('parallel-repeat')),
    );
    expect(responses.every(r => r.status === 201)).toBe(true);
    expect(new Set(responses.map(r => r.body.id)).size).toBe(1);
    expect(await balance(alice.accountId)).toBe(900n);
    expect(await db.transfer.count()).toBe(1);
  });

  it('does not overspend during concurrent transfers', async () => {
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) => send(`parallel-${i}`)),
    );
    expect(responses.filter(r => r.status === 201)).toHaveLength(10);
    expect(responses.filter(r => r.status === 400)).toHaveLength(10);
    expect(await balance(alice.accountId)).toBe(0n);
    expect(await balance(bob.accountId)).toBe(1000n);
    expect(await db.transfer.count()).toBe(10);
  });

  it('rolls back a debit if the recipient cannot receive funds', async () => {
    const max = 9223372036854775807n;
    await db.account.update({
      where: { id: bob.accountId },
      data: { balance: max },
    });

    await send('recipient-limit').expect(409);
    expect(await balance(alice.accountId)).toBe(1000n);
    expect(await balance(bob.accountId)).toBe(max);
    expect(await db.transfer.count()).toBe(0);

    await db.account.update({
      where: { id: bob.accountId },
      data: { balance: 0n },
    });
    await send('recipient-limit').expect(201);
  });

  it('rejects invalid amounts, missing keys and sender injection', async () => {
    for (const amount of ['0', '-1', '1.5', '01', '9223372036854775808', 100]) {
      await send('invalid', amount).expect(400);
    }

    await request(app.getHttpServer())
      .post('/transfers')
      .auth(alice.accessToken, { type: 'bearer' })
      .send({ recipientAccountId: bob.accountId, amount: '100' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/transfers')
      .auth(alice.accessToken, { type: 'bearer' })
      .set('Idempotency-Key', 'injected-sender')
      .send({
        recipientAccountId: bob.accountId,
        amount: '100',
        senderId: bob.accountId,
      })
      .expect(400);

    expect(await db.transfer.count()).toBe(0);
  });

  it('rejects self-transfers and nonexistent recipients', async () => {
    await request(app.getHttpServer())
      .post('/transfers')
      .auth(alice.accessToken, { type: 'bearer' })
      .set('Idempotency-Key', 'self')
      .send({ recipientAccountId: alice.accountId, amount: '100' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/transfers')
      .auth(alice.accessToken, { type: 'bearer' })
      .set('Idempotency-Key', 'missing')
      .send({
        recipientAccountId: '00000000-0000-4000-8000-000000000001',
        amount: '100',
      })
      .expect(404);
  });

  it('paginates history and does not disclose another user history', async () => {
    await send('history-one').expect(201);
    await send('history-two').expect(201);

    const first = await request(app.getHttpServer())
      .get('/transfers?limit=1')
      .auth(alice.accessToken, { type: 'bearer' })
      .expect(200);

    expect(first.body.items).toHaveLength(1);
    expect(first.body.nextCursor).toBeTruthy();

    const second = await request(app.getHttpServer())
      .get(`/transfers?limit=1&cursor=${first.body.nextCursor}`)
      .auth(alice.accessToken, { type: 'bearer' })
      .expect(200);

    expect(second.body.items).toHaveLength(1);
    expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
    expect(second.body.nextCursor).toBeNull();

    const outsider = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'outsider@example.com', password })
      .expect(201);

    const history = await request(app.getHttpServer())
      .get('/transfers')
      .auth(outsider.body.accessToken, { type: 'bearer' })
      .expect(200);
    expect(history.body.items).toEqual([]);

    await request(app.getHttpServer())
      .get(`/transfers?cursor=${first.body.items[0].id}`)
      .auth(outsider.body.accessToken, { type: 'bearer' })
      .expect(400);
  });
});
