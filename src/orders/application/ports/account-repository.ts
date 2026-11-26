import type { Account } from '../../domain/entities/account.js';
import type { AccountId } from '../../domain/value-objects/account-id.js';

export abstract class AccountRepository {
  abstract findById(accountId: AccountId): Promise<Account | null>;

  abstract save(account: Account): Promise<void>;
}
