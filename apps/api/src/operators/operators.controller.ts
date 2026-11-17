import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { OperatorsService } from './operators.service';
import { JwtOrSessionAuthGuard } from '../auth/jwt-or-session-auth.guard';
import { CsrfGuard } from '../auth/csrf.guard';
import { OriginGuard } from '../auth/origin.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('operators')
export class OperatorsController {
  constructor(private operatorsService: OperatorsService) {}

  @UseGuards(JwtOrSessionAuthGuard, CsrfGuard, OriginGuard)
  @Post('onboard')
  async onboard(@Request() req, @Body() body: { companyName: string }) {
    return this.operatorsService.onboard(req.user.userId, body.companyName);
  }
}

@Controller('admin/operators')
export class AdminOperatorsController {
  constructor(private operatorsService: OperatorsService) {}

  @UseGuards(JwtOrSessionAuthGuard, RolesGuard)
  @Roles('admin')
  @Get('pending')
  async listPending() {
    return this.operatorsService.listPending();
  }

  @UseGuards(JwtOrSessionAuthGuard, RolesGuard, CsrfGuard, OriginGuard)
  @Roles('admin')
  @Post(':id/verify')
  async verify(@Param('id') id: string, @Request() req) {
    return this.operatorsService.verify(id, req.user.userId);
  }
}
