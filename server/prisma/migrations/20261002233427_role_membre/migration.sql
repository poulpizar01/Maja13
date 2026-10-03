-- AlterTable
ALTER TABLE "members" ADD COLUMN     "has_member_role" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "settings" (
    "key" VARCHAR(40) NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);
