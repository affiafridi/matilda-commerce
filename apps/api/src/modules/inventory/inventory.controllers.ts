import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from '@matilda/validation';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Actor, type AdminActor, uuidPipe } from '../admin/admin-common';
import { RequirePermission } from '../iam/authorization/decorators';
import { ReservationsService, reservationListQuery } from './reservations.service';
import {
  TransfersService,
  cancelTransferBody,
  createTransferBody,
  receiveTransferBody,
  shipTransferBody,
  transferListQuery,
} from './transfers.service';
import {
  StockService,
  countBody,
  createStockBody,
  movementBody,
  movementListQuery,
  settingsBody,
  stockListQuery,
  updateStockBody,
} from './stock.service';

/**
 * Stock levels and the movement ledger. The route permission only gates entry; the service checks
 * `inventory.view` / `inventory.adjust` over the brand, and over the branch of each stock row, so
 * a branch manager sees and changes only their own branch's stock.
 */
@ApiTags('admin-inventory')
@Controller({ path: 'admin/brands/:brandId/inventory', version: '1' })
export class AdminInventoryController {
  constructor(private readonly stock: StockService) {}

  @Get('settings')
  @RequirePermission('inventory.view')
  @ApiOperation({ summary: 'Brand inventory settings (reservation window, backorder default)' })
  getSettings(@Actor() actor: AdminActor, @Param('brandId', uuidPipe) brandId: string) {
    return this.stock.getSettings(actor, brandId);
  }

  @Put('settings')
  @RequirePermission('inventory.adjust')
  putSettings(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Body(new ZodValidationPipe(settingsBody)) body: z.infer<typeof settingsBody>,
  ) {
    return this.stock.putSettings(actor, brandId, body);
  }

  @Get('stock')
  @RequirePermission('inventory.view')
  @ApiOperation({ summary: 'Stock levels by branch, with available quantity and low-stock flag' })
  list(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Query(new ZodValidationPipe(stockListQuery)) query: z.infer<typeof stockListQuery>,
  ) {
    return this.stock.list(actor, brandId, query);
  }

  @Post('stock')
  @RequirePermission('inventory.adjust')
  @ApiOperation({
    summary: 'Start tracking stock of a product or variation at a branch (zero on hand)',
  })
  create(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Body(new ZodValidationPipe(createStockBody)) body: z.infer<typeof createStockBody>,
  ) {
    return this.stock.create(actor, brandId, body);
  }

  @Get('stock/:id')
  @RequirePermission('inventory.view')
  get(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
  ) {
    return this.stock.get(actor, brandId, id);
  }

  @Patch('stock/:id')
  @RequirePermission('inventory.adjust')
  @ApiOperation({ summary: 'Change the low-stock threshold or out-of-stock behaviour of a row' })
  update(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(updateStockBody)) body: z.infer<typeof updateStockBody>,
  ) {
    return this.stock.update(actor, brandId, id, body);
  }

  @Post('stock/:id/movements')
  @RequirePermission('inventory.adjust')
  @ApiOperation({ summary: 'Record a receipt, adjustment or wastage; stock changes only this way' })
  record(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(movementBody)) body: z.infer<typeof movementBody>,
  ) {
    return this.stock.record(actor, brandId, id, body);
  }

  @Post('stock/:id/count')
  @RequirePermission('inventory.adjust')
  @ApiOperation({
    summary: 'Stocktake: set on-hand to the counted number (recorded as an adjustment)',
  })
  count(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(countBody)) body: z.infer<typeof countBody>,
  ) {
    return this.stock.count(actor, brandId, id, body);
  }

  @Get('stock/:id/movements')
  @RequirePermission('inventory.view')
  @ApiOperation({ summary: 'Movement history of a stock row, newest first' })
  movements(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Query(new ZodValidationPipe(movementListQuery)) query: z.infer<typeof movementListQuery>,
  ) {
    return this.stock.movements(actor, brandId, id, query);
  }
}

/**
 * Open reservations of a brand, so staff can spot holds that leaked and free them. Checkout creates
 * and confirms reservations through the service (Phase 5); there is no public route to hold stock.
 */
@ApiTags('admin-inventory')
@Controller({ path: 'admin/brands/:brandId/inventory/reservations', version: '1' })
export class AdminReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Get()
  @RequirePermission('inventory.view')
  @ApiOperation({ summary: 'Stock and slot reservations of the brand (default: open ones)' })
  list(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Query(new ZodValidationPipe(reservationListQuery)) query: z.infer<typeof reservationListQuery>,
  ) {
    return this.reservations.list(actor, brandId, query);
  }

  @Post(':checkoutRef/release')
  @RequirePermission('inventory.adjust')
  @ApiOperation({ summary: 'Release everything one checkout holds (stuck hold)' })
  release(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('checkoutRef') checkoutRef: string,
  ) {
    return this.reservations.releaseByStaff(actor, brandId, checkoutRef);
  }
}

/**
 * Transfers between branches. Entry needs `inventory.view` (reads) or `inventory.transfer`
 * (writes); the service then checks the permission over the sending or receiving branch.
 */
@ApiTags('admin-inventory')
@Controller({ path: 'admin/brands/:brandId/inventory/transfers', version: '1' })
export class AdminTransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Get()
  @RequirePermission('inventory.view')
  @ApiOperation({ summary: 'Transfers (filter by status, branch or discrepancy)' })
  list(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Query(new ZodValidationPipe(transferListQuery)) query: z.infer<typeof transferListQuery>,
  ) {
    return this.transfers.list(actor, brandId, query);
  }

  @Post()
  @RequirePermission('inventory.transfer')
  @ApiOperation({ summary: 'Request a transfer of stock from one branch to another' })
  create(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Body(new ZodValidationPipe(createTransferBody)) body: z.infer<typeof createTransferBody>,
  ) {
    return this.transfers.create(actor, brandId, body);
  }

  @Get(':id')
  @RequirePermission('inventory.view')
  get(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
  ) {
    return this.transfers.get(actor, brandId, id);
  }

  @Post(':id/ship')
  @RequirePermission('inventory.transfer')
  @ApiOperation({
    summary: 'Ship a requested transfer: takes the shipped quantity out of the sender',
  })
  ship(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(shipTransferBody)) body: z.infer<typeof shipTransferBody>,
  ) {
    return this.transfers.ship(actor, brandId, id, body);
  }

  @Post(':id/receive')
  @RequirePermission('inventory.transfer')
  @ApiOperation({ summary: 'Receive a transfer in transit; differences need a note' })
  receive(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(receiveTransferBody)) body: z.infer<typeof receiveTransferBody>,
  ) {
    return this.transfers.receive(actor, brandId, id, body);
  }

  @Post(':id/cancel')
  @RequirePermission('inventory.transfer')
  @ApiOperation({ summary: 'Cancel a transfer that has not shipped' })
  cancel(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(cancelTransferBody)) body: z.infer<typeof cancelTransferBody>,
  ) {
    return this.transfers.cancel(actor, brandId, id, body);
  }
}
