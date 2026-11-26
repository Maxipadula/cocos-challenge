import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Matches } from 'class-validator';

const DECIMAL = /^\d+(?:\.\d+)?$/;

export class SubmitCashMovementDto {
  @ApiProperty({
    enum: ['CASH_IN', 'CASH_OUT'],
    description:
      'CASH_IN is a deposit. CASH_OUT is a withdrawal checked against available cash, not settled cash.',
  })
  @IsIn(['CASH_IN', 'CASH_OUT'])
  side: 'CASH_IN' | 'CASH_OUT';

  @ApiProperty({
    example: '1500.50',
    description: 'Amount as a decimal string. The ARS instrument is resolved by the server.',
  })
  @IsString()
  @Matches(DECIMAL, { message: 'amount must be a decimal string.' })
  amount: string;
}
