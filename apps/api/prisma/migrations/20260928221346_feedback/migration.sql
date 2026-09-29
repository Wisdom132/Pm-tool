-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('new', 'triaged', 'resolved');

-- CreateTable
CREATE TABLE "feedback" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "environment_id" UUID,
    "message" TEXT NOT NULL,
    "page_url" TEXT NOT NULL,
    "page_path" TEXT NOT NULL,
    "element" TEXT,
    "source_file" TEXT,
    "source_line" INTEGER,
    "author_name" TEXT,
    "author_email" TEXT,
    "author_user_id" UUID,
    "viewport" TEXT,
    "user_agent" TEXT,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'new',
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMP(3),
    "promoted_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feedback_organisation_id_status_created_at_idx" ON "feedback"("organisation_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "feedback_site_id_idx" ON "feedback"("site_id");

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_environment_id_fkey" FOREIGN KEY ("environment_id") REFERENCES "site_environment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
