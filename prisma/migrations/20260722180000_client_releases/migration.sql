-- CreateTable
CREATE TABLE "client_releases" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_key" TEXT,
    "file_size" BIGINT,
    "notes" TEXT NOT NULL DEFAULT '',
    "is_latest" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_releases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_releases_platform_created_at_idx" ON "client_releases"("platform", "created_at" DESC);

-- CreateIndex
CREATE INDEX "client_releases_version_platform_idx" ON "client_releases"("version", "platform");
