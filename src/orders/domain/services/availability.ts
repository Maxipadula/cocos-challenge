import type { CashMovement } from '../entities/cash-movement.js';
import type { TradeOrder } from '../entities/trade-order.js';

export type AccountEntry = TradeOrder | CashMovement;
