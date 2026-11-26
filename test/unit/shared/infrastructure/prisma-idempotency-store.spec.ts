import { describe, expect, it, vi } from 'vitest';

import type { NewIdempotencyRecord } from '#shared/application/idempotency-store.js';
import { UuidGenerator } from '#shared/application/uuid-generator.js';
import { uuid } from '#shared/domain/value-objects/uuid.js';
import {
  ActiveTransactionRequiredError,
  PrismaClientProvider,
} from '#shared/infrastructure/prisma/prisma-client.provider.js';
import { PrismaIdempotencyStore } from '#shared/infrastructure/prisma/prisma-idempotency-store.js';
import { PrismaUnitOfWork } from '#shared/infrastructure/prisma/prisma-unit-of-work.js';
import type { PrismaService } from '#shared/infrastructure/prisma/prisma.service.js';

const user = uuid('00000000-0000-4000-8000-000000000007');
const recordId = '00000000-0000-4000-8000-000000000099';

const storedResult = {
  outcome: 'FILLED',
  accountId: '00000000-0000-4000-8000-000000000003',
  rejectionReason: null,
};

class FixedUuidGenerator extends UuidGenerator {
  override generate(): string {
    return recordId;
  }
}

function record(): NewIdempotencyRecord {
  return {
    userId: user,
    idempotencyKey: 'client-key',
    operation: 'orders.submit-trade',
    requestHash: 'a'.repeat(64),
    result: storedResult,
  };
}

function createHarness() {
  const rootFind = vi.fn();
  const rootCreate = vi.fn();
  const transactionFind = vi.fn();
  const transactionCreate = vi.fn();
  const transaction = {
    idempotencyRecord: {
      findUnique: transactionFind,
      create: transactionCreate,
    },
  };
  const prisma = {
    idempotencyRecord: {
      findUnique: rootFind,
      create: rootCreate,
    },
    $transaction: vi.fn(
      async (work: (current: typeof transaction) => Promise<unknown>) =>
        work(transaction),
    ),
  } as unknown as PrismaService;
  const provider = new PrismaClientProvider(prisma);
  const getClient = vi.spyOn(provider, 'getClient');
  const getTransactionClient = vi.spyOn(provider, 'getTransactionClient');

  return {
    rootFind,
    rootCreate,
    transactionFind,
    transactionCreate,
    getClient,
    getTransactionClient,
    unitOfWork: new PrismaUnitOfWork(prisma),
    store: new PrismaIdempotencyStore(provider, new FixedUuidGenerator()),
  };
}

describe('PrismaIdempotencyStore', () => {
  it('returns null when the key does not exist', async () => {
    const { rootFind, transactionFind, getTransactionClient, store } =
      createHarness();
    rootFind.mockResolvedValue(null);

    await expect(store.find(user, 'client-key')).resolves.toBeNull();
    expect(rootFind).toHaveBeenCalledWith({
      where: {
        userId_idempotencyKey: { userId: user, idempotencyKey: 'client-key' },
      },
      select: { operation: true, requestHash: true, result: true },
    });
    expect(transactionFind).not.toHaveBeenCalled();
    expect(getTransactionClient).not.toHaveBeenCalled();
  });

  it('reconstructs a stored result from the root client', async () => {
    const { rootFind, getClient, store } = createHarness();
    rootFind.mockResolvedValue({
      operation: 'orders.submit-trade',
      requestHash: 'a'.repeat(64),
      result: storedResult,
    });

    await expect(store.find(user, 'client-key')).resolves.toEqual({
      operation: 'orders.submit-trade',
      requestHash: 'a'.repeat(64),
      result: storedResult,
    });
    expect(getClient).toHaveBeenCalledOnce();
    expect(getClient).toHaveReturnedWith(
      expect.objectContaining({
        idempotencyRecord: expect.objectContaining({ findUnique: rootFind }),
      }),
    );
  });

  it('reads through the transactional client inside UnitOfWork', async () => {
    const { rootFind, transactionFind, getClient, unitOfWork, store } =
      createHarness();
    transactionFind.mockResolvedValue({
      operation: 'orders.cancel-trade',
      requestHash: 'b'.repeat(64),
      result: { outcome: 'NOT_FOUND' },
    });

    const found = await unitOfWork.run(() => store.find(user, 'client-key'));

    expect(found).toEqual({
      operation: 'orders.cancel-trade',
      requestHash: 'b'.repeat(64),
      result: { outcome: 'NOT_FOUND' },
    });
    expect(rootFind).not.toHaveBeenCalled();
    expect(transactionFind).toHaveBeenCalledOnce();
    expect(getClient).toHaveBeenCalledOnce();
  });

  it('persists a completed record inside the transaction', async () => {
    const {
      rootCreate,
      transactionCreate,
      getClient,
      getTransactionClient,
      unitOfWork,
      store,
    } = createHarness();
    transactionCreate.mockResolvedValue({});

    await unitOfWork.run(() => store.save(record()));

    expect(getTransactionClient).toHaveBeenCalledOnce();
    expect(getClient).not.toHaveBeenCalled();
    expect(rootCreate).not.toHaveBeenCalled();
    expect(transactionCreate).toHaveBeenCalledOnce();

    const data = transactionCreate.mock.calls[0]?.[0].data;
    expect(data.id).toBe(recordId);
    expect(data.userId).toBe(user);
    expect(data.idempotencyKey).toBe('client-key');
    expect(data.operation).toBe('orders.submit-trade');
    expect(data.requestHash).toBe('a'.repeat(64));
    expect(data.result).toEqual(storedResult);
    expect(data.createdAt).toBeInstanceOf(Date);
    expect(data.completedAt).toBe(data.createdAt);
  });

  it('propagates ActiveTransactionRequiredError when saving outside a transaction', async () => {
    const { rootCreate, transactionCreate, getClient, store } = createHarness();

    await expect(store.save(record())).rejects.toBeInstanceOf(
      ActiveTransactionRequiredError,
    );
    expect(getClient).not.toHaveBeenCalled();
    expect(rootCreate).not.toHaveBeenCalled();
    expect(transactionCreate).not.toHaveBeenCalled();
  });

  it('propagates a unique constraint failure', async () => {
    const { transactionCreate, unitOfWork, store } = createHarness();
    const unique = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
    });
    transactionCreate.mockRejectedValue(unique);

    await expect(unitOfWork.run(() => store.save(record()))).rejects.toBe(
      unique,
    );
  });

  it('propagates a persistence failure', async () => {
    const { transactionCreate, unitOfWork, store } = createHarness();
    const failure = new Error('insert failed');
    transactionCreate.mockRejectedValue(failure);

    await expect(unitOfWork.run(() => store.save(record()))).rejects.toBe(
      failure,
    );
  });
});
