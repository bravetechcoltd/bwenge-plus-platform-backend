const { Client } = require('pg');

const databaseUrl = "postgres://postgres:YJipgXJuVLMLihCnMQjZN6CuesyXLPSFWadd3t9ec0gsR6YSt2K8iILqyhpBZ65a@168.231.79.158:5432/postgres";

async function fixMissingColumns() {
  const client = new Client({
    connectionString: databaseUrl,
    ssl: false,
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // Check and add missing columns to space table
    console.log('🔧 Checking space table columns...');
    
    const spaceColumns = [
      { name: 'institutionId', type: 'UUID' },
      { name: 'name', type: 'VARCHAR(255)' },
      { name: 'spaceType', type: 'VARCHAR DEFAULT \'COURSE_SPACE\'' },
    ];
    
    for (const col of spaceColumns) {
      try {
        await client.query(`
          ALTER TABLE space 
          ADD COLUMN IF NOT EXISTS "${col.name}" ${col.type}
        `);
        console.log(`  ✅ Added column: ${col.name}`);
      } catch (err) {
        console.log(`  ⚠️ Could not add ${col.name}: ${err.message}`);
      }
    }

    // Check and add missing columns to conversation table
    console.log('\n🔧 Checking conversation table columns...');
    
    const conversationColumns = [
      { name: 'participantOneId', type: 'UUID' },
      { name: 'participantTwoId', type: 'UUID' },
      { name: 'institutionId', type: 'UUID' },
      { name: 'conversationType', type: 'VARCHAR DEFAULT \'DIRECT\'' },
    ];
    
    for (const col of conversationColumns) {
      try {
        await client.query(`
          ALTER TABLE conversation 
          ADD COLUMN IF NOT EXISTS "${col.name}" ${col.type}
        `);
        console.log(`  ✅ Added column: ${col.name}`);
      } catch (err) {
        console.log(`  ⚠️ Could not add ${col.name}: ${err.message}`);
      }
    }

    // Migrate existing conversation data
    console.log('\n🔄 Migrating existing conversation data...');
    
    const result = await client.query(`
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
    
    console.log(`  ✅ Migrated ${result.rowCount} conversations`);

    // Set NOT NULL constraints if all data is migrated
    const nullCheck = await client.query(`
      SELECT COUNT(*) as count 
      FROM conversation 
      WHERE "participantOneId" IS NULL OR "participantTwoId" IS NULL
    `);
    
    if (parseInt(nullCheck.rows[0].count) === 0) {
      console.log('\n🔧 Setting NOT NULL constraints...');
      try {
        await client.query(`
          ALTER TABLE conversation 
          ALTER COLUMN "participantOneId" SET NOT NULL,
          ALTER COLUMN "participantTwoId" SET NOT NULL
        `);
        console.log('  ✅ NOT NULL constraints set');
      } catch (err) {
        console.log(`  ⚠️ Could not set NOT NULL: ${err.message}`);
      }
    }

    // Drop problematic indexes
    console.log('\n🗑️ Dropping problematic indexes...');
    
    const indexesToDrop = [
      'IDX_16a9af5352d00170944c4cdf3b',
      'IDX_5d4fd47a9f15f3f8134a5f4502',
      'IDX_e330398c18c7d9696967901f16',
      'IDX_7de1443208ed741853efc4a81a'
    ];
    
    for (const idx of indexesToDrop) {
      try {
        await client.query(`DROP INDEX IF EXISTS "${idx}"`);
        console.log(`  ✅ Dropped: ${idx}`);
      } catch (err) {
        console.log(`  ⚠️ Could not drop ${idx}: ${err.message}`);
      }
    }

    // Create new indexes
    console.log('\n📊 Creating new indexes...');
    
    const newIndexes = [
      { name: 'IDX_SPACE_INSTITUTION', table: 'space', column: 'institutionId' },
      { name: 'IDX_SPACE_COURSE', table: 'space', column: 'courseId' },
      { name: 'IDX_CONVERSATION_PARTICIPANT_ONE', table: 'conversation', column: 'participantOneId' },
      { name: 'IDX_CONVERSATION_PARTICIPANT_TWO', table: 'conversation', column: 'participantTwoId' },
      { name: 'IDX_CONVERSATION_INSTITUTION', table: 'conversation', column: 'institutionId' },
      { name: 'IDX_CONVERSATION_COURSE', table: 'conversation', column: 'courseId' },
    ];
    
    for (const idx of newIndexes) {
      try {
        await client.query(`
          CREATE INDEX IF NOT EXISTS "${idx.name}" 
          ON "${idx.table}" ("${idx.column}")
        `);
        console.log(`  ✅ Created: ${idx.name}`);
      } catch (err) {
        console.log(`  ⚠️ Could not create ${idx.name}: ${err.message}`);
      }
    }

    // Verify the fix
    console.log('\n🔍 Verification:');
    
    const spaceCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'space' 
      AND column_name IN ('institutionId', 'name', 'spaceType')
    `);
    
    console.log(`  Space table has ${spaceCheck.rows.length}/3 new columns`);
    
    const conversationCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'conversation' 
      AND column_name IN ('participantOneId', 'participantTwoId', 'institutionId', 'conversationType')
    `);
    
    console.log(`  Conversation table has ${conversationCheck.rows.length}/4 new columns`);
    
    console.log('\n✅ Database fix completed successfully!');
    console.log('\nNow try restarting your server: npm run dev');
    
  } catch (error) {
    console.error('❌ Error during fix:', error);
  } finally {
    await client.end();
    console.log('\n📦 Database connection closed');
  }
}

fixMissingColumns();