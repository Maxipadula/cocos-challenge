import { ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { SubmitCashMovementDto } from '#orders/presentation/submit-cash-movement.dto.js';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: false },
});

describe('SubmitCashMovementDto', () => {
  it('accepts a deposit amount as a string', async () => {
    await expect(
      pipe.transform(
        { side: 'CASH_IN', amount: '1500.50' },
        { type: 'body', metatype: SubmitCashMovementDto },
      ),
    ).resolves.toEqual({ side: 'CASH_IN', amount: '1500.50' });
  });

  it('rejects a numeric amount, an unknown side, and an instrument id', async () => {
    await expect(
      pipe.transform(
        { side: 'CASH_IN', amount: 10 },
        { type: 'body', metatype: SubmitCashMovementDto },
      ),
    ).rejects.toThrow();
    await expect(
      pipe.transform(
        { side: 'BUY', amount: '10.00' },
        { type: 'body', metatype: SubmitCashMovementDto },
      ),
    ).rejects.toThrow();
    await expect(
      pipe.transform(
        {
          side: 'CASH_OUT',
          amount: '10.00',
          instrumentId: 'a3000000-0000-4000-8000-000000000042',
          price: '1',
          type: 'MARKET',
        },
        { type: 'body', metatype: SubmitCashMovementDto },
      ),
    ).rejects.toThrow();
  });
});
