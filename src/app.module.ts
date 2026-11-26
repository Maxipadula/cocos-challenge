import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';

import { HttpExceptionFilter } from '#shared/presentation/http-exception.filter.js';
import { SharedModule } from '#shared/shared.module.js';

import { InstrumentsModule } from '#instruments/instruments.module.js';
import { OrdersModule } from '#orders/orders.module.js';
import { PortfolioModule } from '#portfolio/portfolio.module.js';

@Module({
  imports: [SharedModule, OrdersModule, PortfolioModule, InstrumentsModule],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    },
  ],
})
export class AppModule {}
