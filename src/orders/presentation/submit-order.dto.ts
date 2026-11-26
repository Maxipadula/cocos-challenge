import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

const DECIMAL = /^\d+(?:\.\d+)?$/;
const WHOLE_SHARES = /^(?:0|[1-9]\d*)$/;

@ValidatorConstraint({ name: 'submitOrderShape', async: false })
class SubmitOrderShape implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    return shapeError(args.object as SubmitOrderDto) === undefined;
  }

  defaultMessage(args: ValidationArguments): string {
    return (
      shapeError(args.object as SubmitOrderDto) ?? 'Order request is invalid.'
    );
  }
}

export class SubmitOrderDto {
  @ApiProperty({
    format: 'uuid',
    example: 'a3000000-0000-4000-8000-000000000022',
    description:
      'Instrument to trade. Currency instruments are rejected. Provide either quantity or amount, and only one of them. MARKET rejects limitPrice. LIMIT requires limitPrice.',
  })
  @Validate(SubmitOrderShape)
  @IsUUID('all')
  instrumentId: string;

  @ApiProperty({ enum: ['BUY', 'SELL'] })
  @IsIn(['BUY', 'SELL'])
  side: 'BUY' | 'SELL';

  @ApiProperty({
    enum: ['MARKET', 'LIMIT'],
    description:
      'MARKET executes immediately at the latest close. LIMIT stays NEW until it is cancelled. There is no matching.',
  })
  @IsIn(['MARKET', 'LIMIT'])
  type: 'MARKET' | 'LIMIT';

  @ApiPropertyOptional({
    example: '2',
    description: 'Whole number of shares, as a string. Mutually exclusive with amount.',
  })
  @IsOptional()
  @IsString()
  @Matches(WHOLE_SHARES, {
    message: 'quantity must be a whole number of shares.',
  })
  quantity?: string;

  @ApiPropertyOptional({
    example: '1000.00',
    description:
      'Cash amount, as a decimal string. The order size is the floor of amount divided by the price. Mutually exclusive with quantity.',
  })
  @IsOptional()
  @IsString()
  @Matches(DECIMAL, { message: 'amount must be a decimal string.' })
  amount?: string;

  @ApiPropertyOptional({
    example: '100.00',
    description: 'Required for LIMIT and forbidden for MARKET. Decimal string.',
  })
  @IsOptional()
  @IsString()
  @Matches(DECIMAL, { message: 'limitPrice must be a decimal string.' })
  limitPrice?: string;
}

function shapeError(dto: SubmitOrderDto): string | undefined {
  const hasQuantity = dto.quantity !== undefined;
  const hasAmount = dto.amount !== undefined;

  if (hasQuantity === hasAmount) {
    return 'Provide either quantity or amount, and only one of them.';
  }

  if (dto.type === 'MARKET' && dto.limitPrice !== undefined) {
    return 'MARKET orders cannot include limitPrice.';
  }

  if (dto.type === 'LIMIT' && dto.limitPrice === undefined) {
    return 'limitPrice is required.';
  }

  return undefined;
}
