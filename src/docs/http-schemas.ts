import { ApiProperty } from '@nestjs/swagger';

export class ErrorMessageResponse {
  @ApiProperty({
    example: 'Order was not found.',
  })
  message: string;
}

export class InstrumentResponse {
  @ApiProperty({
    format: 'uuid',
    example: 'a3000000-0000-4000-8000-000000000022',
  })
  id: string;

  @ApiProperty({ example: 'GGAL' })
  ticker: string;

  @ApiProperty({ example: 'Grupo Financiero Galicia' })
  name: string;

  @ApiProperty({
    example: 'ACCIONES',
    description: 'Instrument type stored in the database. Currency instruments are excluded from search.',
  })
  type: string;
}

export class PortfolioPositionResponse {
  @ApiProperty({ format: 'uuid' })
  instrumentId: string;

  @ApiProperty({ example: 'PAMP' })
  ticker: string;

  @ApiProperty({ example: 'Pampa Holding S.A.' })
  name: string;

  @ApiProperty({
    example: '40',
    description: 'Settled share quantity. It can be negative. Zero is shown when the instrument only has a reservation.',
  })
  quantity: string;

  @ApiProperty({ example: '0' })
  reservedQuantity: string;

  @ApiProperty({
    example: '40',
    description: 'Settled quantity minus reserved quantity, never below zero.',
  })
  availableQuantity: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '925.85',
    description: 'Latest close. Null when the instrument has no quote.',
  })
  close: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '37034.00',
    description: 'Settled quantity multiplied by the latest close. Reserved shares stay inside the position.',
  })
  marketValue: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '1.5000',
    description: 'Daily move from previousClose to close, with four decimal places. Null when previousClose is zero or the quote is missing.',
  })
  dailyReturnPercentage: string | null;
}

export class PortfolioResponse {
  @ApiProperty({ format: 'uuid' })
  accountId: string;

  @ApiProperty({
    example: '783800',
    description: 'Cash settled by filled orders and cash movements.',
  })
  settledCash: string;

  @ApiProperty({
    example: '125500',
    description: 'Cash reserved by accepted BUY LIMIT orders that are still NEW.',
  })
  reservedCash: string;

  @ApiProperty({
    example: '658300',
    description: 'Settled cash minus reserved cash. It can be negative when reserves exceed settled cash.',
  })
  availableCash: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '890500',
    description: 'Settled cash plus the market value of settled share quantities. Reservations are not subtracted. Null when any position has no quote.',
  })
  totalValue: string | null;

  @ApiProperty({ type: [PortfolioPositionResponse] })
  positions: PortfolioPositionResponse[];
}

export class SubmittedOrderResponse {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  accountId: string;

  @ApiProperty({ format: 'uuid' })
  instrumentId: string;

  @ApiProperty({ enum: ['BUY', 'SELL'] })
  side: 'BUY' | 'SELL';

  @ApiProperty({ enum: ['MARKET', 'LIMIT'] })
  type: 'MARKET' | 'LIMIT';

  @ApiProperty({
    enum: ['NEW', 'FILLED', 'REJECTED'],
    description: 'MARKET orders are FILLED or REJECTED immediately. Accepted LIMIT orders stay NEW. There is no LIMIT execution or matching.',
  })
  status: 'NEW' | 'FILLED' | 'REJECTED';

  @ApiProperty({
    example: '2',
    description: 'Whole shares. When the request sends an amount, this is the floor of amount divided by the price. The unused remainder is not reserved.',
  })
  size: string;

  @ApiProperty({
    example: '100.50',
    description: 'MARKET uses the latest close. LIMIT uses the submitted limit price.',
  })
  price: string;

  @ApiProperty({
    type: String,
    nullable: true,
    enum: ['INSUFFICIENT_CASH', 'INSUFFICIENT_SHARES'],
    example: null,
  })
  rejectionReason: 'INSUFFICIENT_CASH' | 'INSUFFICIENT_SHARES' | null;

  @ApiProperty({ format: 'date-time' })
  placedAt: string;
}

export class SubmittedCashMovementResponse {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  accountId: string;

  @ApiProperty({
    format: 'uuid',
    description: 'ARS currency instrument resolved by the server.',
  })
  instrumentId: string;

  @ApiProperty({ enum: ['CASH_IN', 'CASH_OUT'] })
  side: 'CASH_IN' | 'CASH_OUT';

  @ApiProperty({ enum: ['FILLED', 'REJECTED'] })
  status: 'FILLED' | 'REJECTED';

  @ApiProperty({ example: '1500.50' })
  amount: string;

  @ApiProperty({
    type: String,
    nullable: true,
    enum: ['INSUFFICIENT_CASH'],
    example: null,
    description: 'INSUFFICIENT_CASH when a withdrawal exceeds available cash. Otherwise null.',
  })
  rejectionReason: 'INSUFFICIENT_CASH' | null;

  @ApiProperty({ format: 'date-time' })
  placedAt: string;
}

export class CancelledOrderResponse {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  accountId: string;

  @ApiProperty({ format: 'uuid' })
  instrumentId: string;

  @ApiProperty({ enum: ['BUY', 'SELL'] })
  side: 'BUY' | 'SELL';

  @ApiProperty({ enum: ['LIMIT'] })
  type: 'LIMIT';

  @ApiProperty({ enum: ['CANCELLED'] })
  status: 'CANCELLED';

  @ApiProperty({ example: '10' })
  size: string;

  @ApiProperty({ example: '100' })
  price: string;

  @ApiProperty({ format: 'date-time' })
  placedAt: string;
}
