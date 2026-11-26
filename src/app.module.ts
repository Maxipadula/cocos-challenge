import { Module } from '@nestjs/common';

import { SharedModule } from '#shared/shared.module.js';

import { InstrumentsModule } from '#instruments/instruments.module.js';
import { OrdersModule } from '#orders/orders.module.js';
import { PortfolioModule } from '#portfolio/portfolio.module.js';

@Module({
  imports: [SharedModule, OrdersModule, PortfolioModule, InstrumentsModule],
})
export class AppModule {}
