-- CreateIndex
CREATE INDEX "members_rank_idx" ON "members"("rank");

-- CreateIndex
CREATE INDEX "messages_member_id_idx" ON "messages"("member_id");

-- CreateIndex
CREATE INDEX "org_entries_rank_position_idx" ON "org_entries"("rank", "position");

-- CreateIndex
CREATE INDEX "photos_member_id_idx" ON "photos"("member_id");
