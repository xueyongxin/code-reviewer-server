import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import type { Request } from 'express';
import { assertRateLimit } from '../common/rate-limit';
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
  SendEmailCodeDto,
  SendSmsDto,
  WebHandoffExchangeDto,
} from './auth.dto';

const clientKey = (req: Request, extra = '') =>
  `${req.ip || 'unknown'}:${extra}`;

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
    assertRateLimit(clientKey(req, 'register'), 10, 60_000);
    return this.auth.register(dto, {
      ip: req.ip,
      ua: req.headers['user-agent'],
    });
  }

  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    assertRateLimit(clientKey(req, `login:${dto.email}`), 20, 60_000);
    return this.auth.login(dto, {
      ip: req.ip,
      ua: req.headers['user-agent'],
    });
  }

  @Post('sms/send')
  sendSms(@Body() dto: SendSmsDto, @Req() req: Request) {
    assertRateLimit(clientKey(req, `sms:${dto.phone}`), 5, 60_000, '短信发送过于频繁');
    assertRateLimit(clientKey(req, 'sms-ip'), 20, 60_000, '短信发送过于频繁');
    return this.auth.sendSms(dto);
  }

  @Post('email/send')
  sendEmailCode(@Body() dto: SendEmailCodeDto, @Req() req: Request) {
    assertRateLimit(
      clientKey(req, `email:${dto.email}`),
      5,
      60_000,
      '邮件验证码发送过于频繁',
    );
    assertRateLimit(clientKey(req, 'email-ip'), 20, 60_000, '邮件验证码发送过于频繁');
    return this.auth.sendEmailCode(dto);
  }

  @Post('register/phone')
  registerPhone(@Body() dto: RegisterPhoneDto, @Req() req: Request) {
    assertRateLimit(clientKey(req, 'register-phone'), 10, 60_000);
    return this.auth.registerPhone(dto, {
      ip: req.ip,
      ua: req.headers['user-agent'],
    });
  }

  @Post('login/phone')
  loginPhone(@Body() dto: LoginPhoneDto, @Req() req: Request) {
    assertRateLimit(clientKey(req, `login-phone:${dto.phone}`), 20, 60_000);
    return this.auth.loginPhone(dto, {
      ip: req.ip,
      ua: req.headers['user-agent'],
    });
  }

  @Post('login/sms')
  loginSms(@Body() dto: LoginSmsDto, @Req() req: Request) {
    assertRateLimit(clientKey(req, `login-sms:${dto.phone}`), 20, 60_000);
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
  exchangeDesktopCode(@Body() dto: DesktopExchangeDto, @Req() req: Request) {
    assertRateLimit(clientKey(req, 'desktop-exchange'), 20, 60_000);
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
  exchangeWebHandoff(@Body() dto: WebHandoffExchangeDto, @Req() req: Request) {
    assertRateLimit(clientKey(req, 'web-exchange'), 20, 60_000);
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
