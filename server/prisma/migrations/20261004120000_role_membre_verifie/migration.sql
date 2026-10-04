-- Rôle membre : on garde l'identifiant du rôle porté à la connexion, et non plus un simple oui/non. Changer le rôle
-- membre dans Hiérarchie retire alors aussitôt l'accès à ceux qui n'avaient que l'ancien (ranks.ts, canMember).
ALTER TABLE "members" ADD COLUMN "member_role" VARCHAR(32);

-- comptes qui portaient le rôle réglé actuellement : ils le gardent sans avoir à se reconnecter
UPDATE "members" SET "member_role" = (SELECT "value" FROM "settings" WHERE "key" = 'member_role_id') WHERE "has_member_role";

ALTER TABLE "members" DROP COLUMN "has_member_role";
