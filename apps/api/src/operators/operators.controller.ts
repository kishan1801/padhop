import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { OperatorsService } from './operators.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('operators')
export class OperatorsController {
  constructor(private operatorsService: OperatorsService) { }

  @UseGuards(JwtAuthGuard)
  @Post('onboard')
  async onboard(@Request() req, @Body() body: { companyName: string }) {
    return this.operatorsService.onboard(req.user.userId, body.companyName);
  }
}

@Controller('admin/operators')
export class AdminOperatorsController {
  constructor(private operatorsService: OperatorsService) { }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get('pending')
  async listPending() {
    return this.operatorsService.listPending();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post(':id/verify')
  async verify(@Param('id') id: string) {
    return this.operatorsService.verify(id);
  }
}