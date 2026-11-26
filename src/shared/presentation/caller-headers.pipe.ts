import type { IncomingHttpHeaders } from 'node:http';

import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { UserHeaderDto, WriteHeadersDto } from './caller-headers.dto.js';

@Injectable()
export class UserHeaderPipe implements PipeTransform {
  async transform(headers: IncomingHttpHeaders): Promise<UserHeaderDto> {
    return validateHeaders(UserHeaderDto, {
      userId: oneHeader(headers['x-user-id'], 'X-User-Id'),
    });
  }
}

@Injectable()
export class WriteHeadersPipe implements PipeTransform {
  async transform(headers: IncomingHttpHeaders): Promise<WriteHeadersDto> {
    return validateHeaders(WriteHeadersDto, {
      userId: oneHeader(headers['x-user-id'], 'X-User-Id'),
      idempotencyKey: oneHeader(headers['idempotency-key'], 'Idempotency-Key'),
    });
  }
}

function oneHeader(
  value: string | string[] | undefined,
  name: string,
): string | undefined {
  if (Array.isArray(value)) {
    throw new BadRequestException(`${name} header must be a single value.`);
  }

  const trimmed = value?.trim();

  return trimmed === '' ? undefined : trimmed;
}

async function validateHeaders<T extends object>(
  type: new () => T,
  value: object,
): Promise<T> {
  const dto = plainToInstance(type, value);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  if (errors.length > 0) {
    throw new BadRequestException(
      errors.flatMap((error) => Object.values(error.constraints ?? {})),
    );
  }

  return dto;
}
