-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "members" (
    "id" SERIAL NOT NULL,
    "discord_id" VARCHAR(32) NOT NULL,
    "username" VARCHAR(64) NOT NULL,
    "avatar" VARCHAR(128),
    "display_name" VARCHAR(64),
    "rank" VARCHAR(20),
    "bio" TEXT,
    "phone_rp" VARCHAR(32),
    "status" "MemberStatus" NOT NULL DEFAULT 'pending',
    "is_owner" BOOLEAN NOT NULL DEFAULT false,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login" TIMESTAMPTZ(6),
    "approved_at" TIMESTAMPTZ(6),
    "approved_by" INTEGER,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ranks" (
    "key" VARCHAR(20) NOT NULL,
    "label" VARCHAR(40) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "color" VARCHAR(7),
    "description" TEXT,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "can_admin" BOOLEAN NOT NULL DEFAULT false,
    "can_manage" BOOLEAN NOT NULL DEFAULT false,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "discord_role_id" VARCHAR(32),

    CONSTRAINT "ranks_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "org_entries" (
    "id" SERIAL NOT NULL,
    "rank" VARCHAR(20) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "subtitle" VARCHAR(80),
    "description" TEXT,
    "is_open" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "org_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" SERIAL NOT NULL,
    "member_id" INTEGER NOT NULL,
    "content" VARCHAR(1000) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_reads" (
    "member_id" INTEGER NOT NULL,
    "last_read_id" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_reads_pkey" PRIMARY KEY ("member_id")
);

-- CreateTable
CREATE TABLE "photos" (
    "id" SERIAL NOT NULL,
    "member_id" INTEGER NOT NULL,
    "file" VARCHAR(200) NOT NULL,
    "thumb" VARCHAR(200) NOT NULL,
    "url" TEXT NOT NULL,
    "thumb_url" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "caption" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "sid" VARCHAR NOT NULL,
    "sess" JSON NOT NULL,
    "expire" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);

-- CreateIndex
CREATE UNIQUE INDEX "members_discord_id_key" ON "members"("discord_id");

-- CreateIndex
CREATE UNIQUE INDEX "ranks_discord_role_id_key" ON "ranks"("discord_role_id");

-- CreateIndex
CREATE INDEX "messages_created_at_idx" ON "messages"("created_at" DESC);

-- CreateIndex
CREATE INDEX "photos_created_at_idx" ON "photos"("created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_session_expire" ON "session"("expire");

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_rank_fkey" FOREIGN KEY ("rank") REFERENCES "ranks"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_entries" ADD CONSTRAINT "org_entries_rank_fkey" FOREIGN KEY ("rank") REFERENCES "ranks"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_reads" ADD CONSTRAINT "chat_reads_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Un seul grade par défaut à la fois (index partiel, non exprimable dans schema.prisma)
CREATE UNIQUE INDEX "ranks_single_default" ON "ranks"((true)) WHERE "is_default";
