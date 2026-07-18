import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { AuthService } from './auth.service';
import {
  DesktopExchangeDto,
  DesktopIssueCodeDto,
  LoginDto,
  LoginPhoneDto,
  LoginSmsDto,
  RegisterDto,
  RegisterPhoneDto,
  SendSmsDto,
  WebHandoffExchangeDto,
} from './auth.dto';

class RefreshDto {
  @IsString()
  refreshToken!: string;
}

class LogoutDto {
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.auth.register(dto, {
      ip: req.ip,
      ua: req.headers['user-agent'],
    });
  }

  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, {
      ip: req.ip,
      ua: req.headers['user-agent'],
    });
  }

  @Post('sms/send')
  sendSms(@Body() dto: SendSmsDto) {
    return this.auth.sendSms(dto);
  }

  @Post('register/phone')
  registerPhone(@Body() dto: RegisterPhoneDto, @Req() req: Request) {
    return this.auth.registerPhone(dto, {
      ip: req.ip,
      ua: req.headers['user-agent'],
    });
  }

  @Post('login/phone')
  loginPhone(@Body() dto: LoginPhoneDto, @Req() req: Request) {
    return this.auth.loginPhone(dto, {
      ip: req.ip,
      ua: req.headers['user-agent'],
    });
  }

  @Post('login/sms')
  loginSms(@Body() dto: LoginSmsDto, @Req() req: Request) {
    return this.auth.loginSms(dto, {
      ip: req.ip,
      ua: req.headers['user-agent'],
    });
  }

  /** 网页登录后签发桌面端一次性授权码 */
  @Post('desktop/issue-code')
  @UseGuards(JwtAuthGuard)
  issueDesktopCode(
    @Body() dto: DesktopIssueCodeDto,
    @Req() req: { user: { userId: string } },
  ) {
    return this.auth.issueDesktopCode(req.user.userId, dto.state);
  }

  /** 桌面端用授权码换取 Token */
  @Post('desktop/exchange')
  exchangeDesktopCode(@Body() dto: DesktopExchangeDto) {
    return this.auth.exchangeDesktopCode(dto.code, dto.state);
  }

  /** 桌面端已登录 → 签发网页控制台交接码 */
  @Post('web/handoff')
  @UseGuards(JwtAuthGuard)
  issueWebHandoff(@Req() req: { user: { userId: string } }) {
    return this.auth.issueWebHandoff(req.user.userId);
  }

  /** 浏览器用交接码换取会话 */
  @Post('web/exchange')
  exchangeWebHandoff(@Body() dto: WebHandoffExchangeDto) {
    return this.auth.exchangeWebHandoff(dto.code);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  logout(@Body() dto: LogoutDto) {
    return this.auth.logout(dto.refreshToken);
  }
}
