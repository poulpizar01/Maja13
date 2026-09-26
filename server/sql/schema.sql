-- La Maja 13 — schéma de La Casa (appliqué à chaque démarrage : chaque bloc est idempotent)
CREATE TABLE IF NOT EXISTS members (
  id            SERIAL PRIMARY KEY,
  discord_id    VARCHAR(32) UNIQUE NOT NULL,
  username      VARCHAR(64) NOT NULL,          -- pseudo Discord
  avatar        VARCHAR(128),                  -- hash avatar Discord
  display_name  VARCHAR(64),                   -- nom RP (modifiable par le membre)
  rank          VARCHAR(20),                   -- grade (table ranks) ; NULL = sans grade
  bio           TEXT,
  phone_rp      VARCHAR(32),
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login    TIMESTAMPTZ
);

-- table de sessions (connect-pg-simple)
CREATE TABLE IF NOT EXISTS session (
  sid    VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
  sess   JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_expire ON session (expire);

-- v2 : validation des comptes par le Jefe
ALTER TABLE members ADD COLUMN IF NOT EXISTS status VARCHAR(12) NOT NULL DEFAULT 'pending';
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_status_check;
ALTER TABLE members ADD CONSTRAINT members_status_check CHECK (status IN ('pending','approved','rejected'));
ALTER TABLE members ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE members ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES members(id);

-- v3 : chat de la familia
CREATE TABLE IF NOT EXISTS messages (
  id          SERIAL PRIMARY KEY,
  member_id   INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  content     VARCHAR(1000) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages (created_at DESC);

-- v5 : organigramme public
CREATE TABLE IF NOT EXISTS org_entries (
  id          SERIAL PRIMARY KEY,
  rank        VARCHAR(20) NOT NULL,
  name        VARCHAR(64) NOT NULL,
  subtitle    VARCHAR(80),
  description TEXT,
  is_open     BOOLEAN NOT NULL DEFAULT FALSE,
  position    INTEGER NOT NULL DEFAULT 0
);

-- v6 : galerie photo
CREATE TABLE IF NOT EXISTS photos (
  id          SERIAL PRIMARY KEY,
  member_id   INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  file        VARCHAR(80) NOT NULL,
  thumb       VARCHAR(80) NOT NULL,
  width       INTEGER, height INTEGER,
  caption     VARCHAR(200),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_photos_created ON photos (created_at DESC);

-- v7 : lecture du Salon (badge non lus) + historique des paies
CREATE TABLE IF NOT EXISTS chat_reads (
  member_id    INTEGER PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pay_history (
  id          SERIAL PRIMARY KEY,
  week_start  DATE NOT NULL,
  week_end    DATE NOT NULL,
  discord_id  VARCHAR(32) NOT NULL,
  name        VARCHAR(64),
  by_type     JSONB NOT NULL,
  salaire     NUMERIC(12,2) NOT NULL DEFAULT 0,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (week_end, discord_id)
);
CREATE INDEX IF NOT EXISTS idx_pay_history_discord ON pay_history (discord_id, week_end DESC);

-- v8 : grades paramétrables depuis La Casa (page Hiérarchie)
CREATE TABLE IF NOT EXISTS ranks (
  key             VARCHAR(20) PRIMARY KEY,         -- identifiant technique, fixé à la création
  label           VARCHAR(40) NOT NULL,            -- nom affiché
  position        INTEGER NOT NULL DEFAULT 0,      -- ordre dans la hiérarchie (0 = sommet)
  color           VARCHAR(7),                      -- couleur d'accent (#rrggbb)
  description     TEXT,                            -- texte public sous la rangée de l'organigramme
  featured        BOOLEAN NOT NULL DEFAULT FALSE,  -- grande carte sur l'organigramme public
  can_admin       BOOLEAN NOT NULL DEFAULT FALSE,  -- accès à la Gestion (membres, tableau, taxes, armurerie)
  can_manage      BOOLEAN NOT NULL DEFAULT FALSE,  -- pouvoirs complets (grades, hiérarchie, grades à pouvoirs)
  is_default      BOOLEAN NOT NULL DEFAULT FALSE,  -- grade donné aux nouveaux comptes
  discord_role_id VARCHAR(32) UNIQUE               -- rôle Discord qui attribue ce grade à la connexion
);
CREATE UNIQUE INDEX IF NOT EXISTS ranks_single_default ON ranks ((true)) WHERE is_default;

-- Reprise d'une base antérieure à la v8 (grades alors figés dans le code) : ne s'exécute
-- qu'une fois, si la table ranks est vide alors que des membres ont déjà un grade.
-- Sans effet sur une installation neuve ; peut être supprimé une fois la prod migrée.
INSERT INTO ranks (key, label, position, color, featured, can_admin, can_manage, is_default)
SELECT * FROM (VALUES
  ('jefe','Jefe',0,'#9f2635',true,true,true,false), ('segundo','Segundo',1,'#b6512f',true,true,false,false),
  ('devweb','Dev Web',2,NULL,false,true,true,false), ('palabrero','Palabrero',3,'#ad8a4e',true,false,false,false),
  ('commandante','Commandante',4,'#8a7654',false,false,false,false), ('sicario','Sicario',5,'#6d6151',false,false,false,false),
  ('soldado','Soldado',6,'#5a5142',false,false,false,false), ('recluta','Recluta',7,NULL,false,false,false,true)
) AS v(key,label,position,color,featured,can_admin,can_manage,is_default)
WHERE NOT EXISTS (SELECT 1 FROM ranks) AND EXISTS (SELECT 1 FROM members WHERE rank IS NOT NULL);
DO $$ BEGIN
  IF to_regclass('org_rank_desc') IS NOT NULL THEN
    UPDATE ranks r SET description = d.description FROM org_rank_desc d WHERE d.rank = r.key AND r.description IS NULL;
    DROP TABLE org_rank_desc;
  END IF;
END $$;

-- les grades deviennent des références vers ranks
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_rank_check;
ALTER TABLE members ALTER COLUMN rank DROP NOT NULL;
ALTER TABLE members ALTER COLUMN rank DROP DEFAULT;
UPDATE members SET rank = NULL WHERE rank IS NOT NULL AND rank NOT IN (SELECT key FROM ranks);
DELETE FROM org_entries WHERE rank NOT IN (SELECT key FROM ranks);
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_rank_fkey;
ALTER TABLE members ADD CONSTRAINT members_rank_fkey FOREIGN KEY (rank) REFERENCES ranks(key) ON DELETE RESTRICT;
ALTER TABLE org_entries DROP CONSTRAINT IF EXISTS org_entries_rank_fkey;
ALTER TABLE org_entries ADD CONSTRAINT org_entries_rank_fkey FOREIGN KEY (rank) REFERENCES ranks(key) ON DELETE RESTRICT;

-- v9 : galerie — URL publique de chaque fichier (disque local en dev, CDN en production) ;
--      file / thumb deviennent les clés de stockage
ALTER TABLE photos ADD COLUMN IF NOT EXISTS url TEXT;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS thumb_url TEXT;
UPDATE photos SET url = '/uploads/' || file, thumb_url = '/uploads/' || thumb WHERE url IS NULL;
ALTER TABLE photos ALTER COLUMN file TYPE VARCHAR(200), ALTER COLUMN thumb TYPE VARCHAR(200);

-- v10 : propriétaire du site = propriétaire du serveur Discord (mis à jour à chaque connexion) ;
--       les droits de Gestion viennent du grade : l'ancien drapeau is_admin disparaît
ALTER TABLE members ADD COLUMN IF NOT EXISTS is_owner BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE members DROP COLUMN IF EXISTS is_admin;
