import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CancelOrderParams {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  orderId: string;
}
