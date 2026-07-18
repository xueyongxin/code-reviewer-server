import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';
import { normalizePhone } from './phone.util';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsString()
  @MinLength(1)
  displayName!: string;

  @IsOptional()
  @IsString()
  orgName?: string;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}

/** 中国大陆手机号（规范化后校验） */
const PHONE_RE = /^1\d{10}$/;

const PhoneField = () =>
  Transform(({ value }) =>
    typeof value === 'string' ? normalizePhone(value) : value,
  );

export class SendSmsDto {
  @PhoneField()
  @IsString()
  @Matches(PHONE_RE, { message: '手机号格式不正确' })
  phone!: string;
}

export class RegisterPhoneDto {
  @PhoneField()
  @IsString()
  @Matches(PHONE_RE, { message: '手机号格式不正确' })
  phone!: string;

  @IsString()
  @MinLength(4)
  code!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsString()
  @MinLength(1)
  displayName!: string;

  @IsOptional()
  @IsString()
  orgName?: string;
}

export class LoginPhoneDto {
  @PhoneField()
  @IsString()
  @Matches(PHONE_RE, { message: '手机号格式不正确' })
  phone!: string;

  @IsString()
  password!: string;
}

export class LoginSmsDto {
  @PhoneField()
  @IsString()
  @Matches(PHONE_RE, { message: '手机号格式不正确' })
  phone!: string;

  @IsString()
  @MinLength(4)
  code!: string;
}

export class DesktopIssueCodeDto {
  @IsString()
  @MinLength(8)
  state!: string;
}

export class DesktopExchangeDto {
  @IsString()
  code!: string;

  @IsString()
  state!: string;
}

export class WebHandoffExchangeDto {
  @IsString()
  code!: string;
}
