-- CreateEnum
CREATE TYPE "FeedbackSource" AS ENUM ('extension', 'widget');

-- AlterTable
ALTER TABLE "feedback" ADD COLUMN     "assigned_at" TIMESTAMP(3),
ADD COLUMN     "assigned_to_id" UUID,
ADD COLUMN     "author_ip_hash" TEXT,
ADD COLUMN     "screenshot" BYTEA,
ADD COLUMN     "screenshot_type" TEXT,
ADD COLUMN     "source" "FeedbackSource" NOT NULL DEFAULT 'extension';

-- AlterTable
ALTER TABLE "site" ADD COLUMN     "feedback_widget" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "feedback_organisation_id_assigned_to_id_created_at_idx" ON "feedback"("organisation_id", "assigned_to_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
