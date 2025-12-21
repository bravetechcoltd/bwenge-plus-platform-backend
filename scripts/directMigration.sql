-- Add new columns if they don't exist
DO $$ 
BEGIN
    BEGIN
        ALTER TABLE conversation ADD COLUMN IF NOT EXISTS "participantOneId" UUID;
    EXCEPTION
        WHEN duplicate_column THEN NULL;
    END;
    
    BEGIN
        ALTER TABLE conversation ADD COLUMN IF NOT EXISTS "participantTwoId" UUID;
    EXCEPTION
        WHEN duplicate_column THEN NULL;
    END;
    
    BEGIN
        ALTER TABLE conversation ADD COLUMN IF NOT EXISTS "institutionId" UUID;
    EXCEPTION
        WHEN duplicate_column THEN NULL;
    END;
    
    BEGIN
        ALTER TABLE conversation ADD COLUMN IF NOT EXISTS "conversationType" VARCHAR DEFAULT 'DIRECT';
    EXCEPTION
        WHEN duplicate_column THEN NULL;
    END;
END $$;

-- Migrate existing data
UPDATE conversation 
SET 
  "participantOneId" = CASE 
    WHEN "studentId" < "instructorId" THEN "studentId"
    ELSE "instructorId"
  END,
  "participantTwoId" = CASE 
    WHEN "studentId" < "instructorId" THEN "instructorId"
    ELSE "studentId"
  END
WHERE "participantOneId" IS NULL 
  AND "participantTwoId" IS NULL 
  AND "studentId" IS NOT NULL 
  AND "instructorId" IS NOT NULL;

-- Make columns NOT NULL after data is migrated
DO $$ 
BEGIN
    BEGIN
        ALTER TABLE conversation ALTER COLUMN "participantOneId" SET NOT NULL;
    EXCEPTION
        WHEN others THEN NULL;
    END;
    
    BEGIN
        ALTER TABLE conversation ALTER COLUMN "participantTwoId" SET NOT NULL;
    EXCEPTION
        WHEN others THEN NULL;
    END;
END $$;

-- Drop problematic indexes if they exist
DROP INDEX IF EXISTS "IDX_16a9af5352d00170944c4cdf3b";
DROP INDEX IF EXISTS "IDX_5d4fd47a9f15f3f8134a5f4502";
DROP INDEX IF EXISTS "IDX_e330398c18c7d9696967901f16";
DROP INDEX IF EXISTS "IDX_7de1443208ed741853efc4a81a";

-- Create new indexes with specific names (if they don't exist)
DO $$ 
BEGIN
    BEGIN
        CREATE INDEX IF NOT EXISTS "IDX_CONVERSATION_PARTICIPANT_ONE" ON conversation ("participantOneId");
    EXCEPTION
        WHEN duplicate_table THEN NULL;
    END;
    
    BEGIN
        CREATE INDEX IF NOT EXISTS "IDX_CONVERSATION_PARTICIPANT_TWO" ON conversation ("participantTwoId");
    EXCEPTION
        WHEN duplicate_table THEN NULL;
    END;
    
    BEGIN
        CREATE INDEX IF NOT EXISTS "IDX_CONVERSATION_COURSE" ON conversation ("courseId");
    EXCEPTION
        WHEN duplicate_table THEN NULL;
    END;
    
    BEGIN
        CREATE INDEX IF NOT EXISTS "IDX_CONVERSATION_INSTITUTION" ON conversation ("institutionId");
    EXCEPTION
        WHEN duplicate_table THEN NULL;
    END;
    
    BEGIN
        CREATE INDEX IF NOT EXISTS "IDX_SPACE_COURSE" ON space ("courseId");
    EXCEPTION
        WHEN duplicate_table THEN NULL;
    END;
    
    BEGIN
        CREATE INDEX IF NOT EXISTS "IDX_SPACE_INSTITUTION" ON space ("institutionId");
    EXCEPTION
        WHEN duplicate_table THEN NULL;
    END;
END $$;