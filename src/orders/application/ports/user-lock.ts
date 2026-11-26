import type { UserId } from '../../../shared/domain/value-objects/ids.js';

export abstract class UserLock {
  abstract acquire(userId: UserId): Promise<void>;
}
