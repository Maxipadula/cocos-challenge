import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { UuidGenerator } from '../../application/uuid-generator.js';

@Injectable()
export class NodeUuidGenerator extends UuidGenerator {
  override generate(): string {
    return randomUUID();
  }
}
