import type { AccountId } from '../../domain/value-objects/account-id.js';
import type { UserId } from '../types/user-id.js';

export abstract class AccountLock {
  abstract acquireForUser(userId: UserId): Promise<AccountId>;
}
