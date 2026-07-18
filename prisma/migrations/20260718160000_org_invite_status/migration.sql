-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('normal', 'abnormal', 'banned');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('alipay', 'wechat', 'manual', 'other');

-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "OrgInviteStatus" AS ENUM ('pending', 'accepted', 'revoked', 'expired');

-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_org_id_fkey";

-- DropIndex
DROP INDEX "org_members_user_id_idx";

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "payment_method" "PaymentMethod",
ALTER COLUMN "org_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "disabled_at" TIMESTAMP(3),
ADD COLUMN     "disabled_by" TEXT,
ADD COLUMN     "status" "OrgStatus" NOT NULL DEFAULT 'active';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "phone" TEXT,
ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'normal',
ADD COLUMN     "status_changed_at" TIMESTAMP(3),
ADD COLUMN     "status_changed_by" TEXT,
ADD COLUMN     "status_reason" TEXT,
ALTER COLUMN "email" DROP NOT NULL,
ALTER COLUMN "password_hash" DROP NOT NULL;

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "org_invites" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "phone" TEXT,
    "role" "OrgRole" NOT NULL DEFAULT 'member',
    "status" "OrgInviteStatus" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT NOT NULL,
    "accepted_by" TEXT,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_custom_rules" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "platform_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_custom_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_methods" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group_name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "static_rule_ids" JSONB NOT NULL DEFAULT '[]',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_commands" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "slash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "prompt_template" TEXT NOT NULL DEFAULT '',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_catalog_items" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "protocol" TEXT NOT NULL DEFAULT 'openai-compatible',
    "base_url" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "models" JSONB NOT NULL DEFAULT '[]',
    "fallback_models" JSONB NOT NULL DEFAULT '[]',
    "api_key_url" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "llm_catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "org_invites_token_key" ON "org_invites"("token");

-- CreateIndex
CREATE INDEX "org_invites_org_id_status_idx" ON "org_invites"("org_id", "status");

-- CreateIndex
CREATE INDEX "org_invites_phone_status_idx" ON "org_invites"("phone", "status");

-- CreateIndex
CREATE INDEX "user_custom_rules_user_id_created_at_idx" ON "user_custom_rules"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "review_methods_key_key" ON "review_methods"("key");

-- CreateIndex
CREATE INDEX "review_methods_published_sort_order_idx" ON "review_methods"("published", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "chat_commands_key_key" ON "chat_commands"("key");

-- CreateIndex
CREATE UNIQUE INDEX "chat_commands_slash_key" ON "chat_commands"("slash");

-- CreateIndex
CREATE INDEX "chat_commands_published_sort_order_idx" ON "chat_commands"("published", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "llm_catalog_items_key_key" ON "llm_catalog_items"("key");

-- CreateIndex
CREATE INDEX "llm_catalog_items_published_sort_order_idx" ON "llm_catalog_items"("published", "sort_order");

-- CreateIndex
CREATE INDEX "orders_created_by_status_idx" ON "orders"("created_by", "status");

-- CreateIndex
CREATE UNIQUE INDEX "org_members_user_id_key" ON "org_members"("user_id");

-- CreateIndex
CREATE INDEX "organizations_status_idx" ON "organizations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- AddForeignKey
ALTER TABLE "org_invites" ADD CONSTRAINT "org_invites_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_invites" ADD CONSTRAINT "org_invites_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_invites" ADD CONSTRAINT "org_invites_accepted_by_fkey" FOREIGN KEY ("accepted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_custom_rules" ADD CONSTRAINT "user_custom_rules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

