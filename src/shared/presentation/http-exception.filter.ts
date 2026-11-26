import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';

const STATUS_BY_ERROR_NAME: Record<string, number> = {
  InvalidIdError: HttpStatus.BAD_REQUEST,
  InvalidOrderIdError: HttpStatus.BAD_REQUEST,
  InvalidMoneyError: HttpStatus.BAD_REQUEST,
  InvalidUnitPriceError: HttpStatus.BAD_REQUEST,
  InvalidShareQuantityError: HttpStatus.BAD_REQUEST,
  OrderSizeRequiredError: HttpStatus.BAD_REQUEST,
  NonPositiveAmountError: HttpStatus.BAD_REQUEST,
  EmptySearchTermError: HttpStatus.BAD_REQUEST,
  SearchTermTooLongError: HttpStatus.BAD_REQUEST,
  InvalidSearchLimitError: HttpStatus.BAD_REQUEST,
  InstrumentNotFoundError: HttpStatus.UNPROCESSABLE_ENTITY,
  AccountNotFoundError: HttpStatus.NOT_FOUND,
  PortfolioAccountNotFoundError: HttpStatus.NOT_FOUND,
  InstrumentNotTradableError: HttpStatus.UNPROCESSABLE_ENTITY,
  MarketPriceUnavailableError: HttpStatus.UNPROCESSABLE_ENTITY,
  IdempotencyConflictError: HttpStatus.CONFLICT,
  CashCurrencyUnavailableError: HttpStatus.INTERNAL_SERVER_ERROR,
  PortfolioInstrumentMissingError: HttpStatus.INTERNAL_SERVER_ERROR,
  PortfolioCurrencyPositionError: HttpStatus.INTERNAL_SERVER_ERROR,
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json({
        message: httpMessage(exception),
      });
      return;
    }

    const named = exception instanceof Error ? exception : undefined;
    const status = named ? STATUS_BY_ERROR_NAME[named.name] : undefined;

    if (named && status) {
      response.status(status).json({ message: named.message });
      return;
    }

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      message: 'Internal server error.',
    });
  }
}

function httpMessage(exception: HttpException): string {
  const body = exception.getResponse();

  if (typeof body === 'string') {
    return body;
  }

  if (typeof body === 'object' && body && 'message' in body) {
    const message = body.message;

    return Array.isArray(message) ? message.join(' ') : String(message);
  }

  return exception.message;
}
