import type { UserId } from '../../domain/value-objects/user-id.js';

export abstract class UserLock {
  abstract acquire(userId: UserId): Promise<void>;
}
