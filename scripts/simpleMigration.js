const { Client } = require('pg');

const databaseUrl = "postgres://postgres:YJipgXJuVLMLihCnMQjZN6CuesyXLPSFWadd3t9ec0gsR6YSt2K8iILqyhpBZ65a@168.231.79.158:5432/postgres";

async function simpleMigration() {
  const client = new Client({
    connectionString: databaseUrl,
    ssl: false,
  });

  try {
    await client.connect();

    // Step 1: Add columns if they don't exist
    
    const columns = [
      { name: 'participantOneId', type: 'UUID' },
      { name: 'participantTwoId', type: 'UUID' },
      { name: 'institutionId', type: 'UUID' },
      { name: 'conversationType', type: 'VARCHAR DEFAULT \'DIRECT\'' }
    ];
    
    for (const col of columns) {
      try {
        await client.query(`
          ALTER TABLE conversation 
          ADD COLUMN IF NOT EXISTS "${col.name}" ${col.type}
        `);
      } catch (err) {
      }
    }

    // Step 2: Migrate existing data
    
    const migrateResult = await client.query(`
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
        AND "instructorId" IS NOT NULL
    `);
    

    // Step 3: Set NOT NULL constraints (only if data exists)
    
    const checkNull = await client.query(`
      SELECT COUNT(*) as count 
      FROM conversation 
      WHERE "participantOneId" IS NULL OR "participantTwoId" IS NULL
    `);
    
    if (parseInt(checkNull.rows[0].count) === 0) {
      try {
        await client.query(`
          ALTER TABLE conversation 
          ALTER COLUMN "participantOneId" SET NOT NULL,
          ALTER COLUMN "participantTwoId" SET NOT NULL
        `);
      } catch (err) {
      }
    } else {
    }

    // Step 4: Drop problematic indexes
    
    const indexesToDrop = [
      'IDX_16a9af5352d00170944c4cdf3b',
      'IDX_5d4fd47a9f15f3f8134a5f4502',
      'IDX_e330398c18c7d9696967901f16',
      'IDX_7de1443208ed741853efc4a81a'
    ];
    
    for (const idx of indexesToDrop) {
      try {
        await client.query(`DROP INDEX IF EXISTS "${idx}"`);
      } catch (err) {
      }
    }

    // Step 5: Create new indexes
    
    const newIndexes = [
      { name: 'IDX_CONVERSATION_PARTICIPANT_ONE', table: 'conversation', column: 'participantOneId' },
      { name: 'IDX_CONVERSATION_PARTICIPANT_TWO', table: 'conversation', column: 'participantTwoId' },
      { name: 'IDX_CONVERSATION_COURSE', table: 'conversation', column: 'courseId' },
      { name: 'IDX_CONVERSATION_INSTITUTION', table: 'conversation', column: 'institutionId' },
      { name: 'IDX_SPACE_COURSE', table: 'space', column: 'courseId' },
      { name: 'IDX_SPACE_INSTITUTION', table: 'space', column: 'institutionId' }
    ];
    
    for (const idx of newIndexes) {
      try {
        await client.query(`
          CREATE INDEX IF NOT EXISTS "${idx.name}" 
          ON "${idx.table}" ("${idx.column}")
        `);
      } catch (err) {
      }
    }

    // Step 6: Verify the migration
    
    const verifyResult = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT("participantOneId") as has_participant_one,
        COUNT("participantTwoId") as has_participant_two
      FROM conversation
    `);
    
    const total = verifyResult.rows[0];
    
    if (parseInt(total.has_participant_one) === parseInt(total.total)) {
    } else {
    }
    
  } catch (error) {
  } finally {
    await client.end();
  }
}

simpleMigration();