import { Module } from '@nestjs/common';

import { InstrumentQueries } from '#instruments/application/instrument-queries.js';
import { InstrumentsModule } from '#instruments/instruments.module.js';
import { OrdersPortfolioDataProvider } from '#orders/application/orders-portfolio-data.js';
import { OrdersModule } from '#orders/orders.module.js';

import { GetPortfolio } from './application/use-cases/get-portfolio.js';
import { PortfolioController } from './presentation/portfolio.controller.js';

@Module({
  imports: [OrdersModule, InstrumentsModule],
  controllers: [PortfolioController],
  providers: [
    {
      provide: GetPortfolio,
      useFactory: (
        orders: OrdersPortfolioDataProvider,
        instruments: InstrumentQueries,
      ) => new GetPortfolio(orders, instruments),
      inject: [OrdersPortfolioDataProvider, InstrumentQueries],
    },
  ],
})
export class PortfolioModule {}
