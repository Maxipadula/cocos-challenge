import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export class UserHeaderDto {
  @IsUUID('all')
  userId: string;
}

export class WriteHeadersDto extends UserHeaderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  idempotencyKey: string;
}
