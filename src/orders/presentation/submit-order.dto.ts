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
  @Validate(SubmitOrderShape)
  @IsUUID('all')
  instrumentId: string;

  @IsIn(['BUY', 'SELL'])
  side: 'BUY' | 'SELL';

  @IsIn(['MARKET', 'LIMIT'])
  type: 'MARKET' | 'LIMIT';

  @IsOptional()
  @IsString()
  @Matches(WHOLE_SHARES, {
    message: 'quantity must be a whole number of shares.',
  })
  quantity?: string;

  @IsOptional()
  @IsString()
  @Matches(DECIMAL, { message: 'amount must be a decimal string.' })
  amount?: string;

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
