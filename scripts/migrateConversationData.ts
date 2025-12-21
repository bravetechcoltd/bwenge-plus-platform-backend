import 'reflect-metadata';
import { DataSource } from 'typeorm';
import dotenv from 'dotenv';
dotenv.config();

async function migrateConversationData() {
  const dataSource = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    synchronize: false,
    logging: true,
  });

  try {
    await dataSource.initialize();
    console.log('✅ Connected to database');

    // Check if conversation table exists
    const tableExists = await dataSource.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'conversation'
      );
    `);
    
    if (!tableExists[0].exists) {
      console.log('⚠️ Conversation table does not exist yet');
      return;
    }

    // Add new columns if they don't exist
    console.log('📝 Adding new columns if they don\'t exist...');
    
    const columnsToAdd = [
      { name: 'participantOneId', type: 'uuid' },
      { name: 'participantTwoId', type: 'uuid' },
      { name: 'institutionId', type: 'uuid' },
      { name: 'conversationType', type: 'varchar', default: "'DIRECT'" },
    ];
    
    for (const col of columnsToAdd) {
      try {
        await dataSource.query(`
          ALTER TABLE conversation 
          ADD COLUMN IF NOT EXISTS "${col.name}" ${col.type} ${col.default ? `DEFAULT ${col.default}` : ''}
        `);
        console.log(`  ✅ Added column: ${col.name}`);
      } catch (err: any) {
        console.log(`  ⚠️ Could not add column ${col.name}:`, err?.message || 'Unknown error');
      }
    }

    // Migrate existing data
    console.log('\n🔄 Migrating existing conversation data...');
    
    const conversations = await dataSource.query(`
      SELECT id, "studentId", "instructorId", "courseId" 
      FROM conversation 
      WHERE "participantOneId" IS NULL OR "participantTwoId" IS NULL
    `);
    
    console.log(`Found ${conversations.length} conversations to migrate`);
    
    let migratedCount = 0;
    
    for (const conv of conversations) {
      if (conv.studentId && conv.instructorId) {
        const participantOne = conv.studentId < conv.instructorId ? conv.studentId : conv.instructorId;
        const participantTwo = conv.studentId < conv.instructorId ? conv.instructorId : conv.studentId;
        
        await dataSource.query(`
          UPDATE conversation 
          SET "participantOneId" = $1, "participantTwoId" = $2 
          WHERE id = $3
        `, [participantOne, participantTwo, conv.id]);
        
        migratedCount++;
        if (migratedCount % 10 === 0) {
          console.log(`  ✅ Migrated ${migratedCount}/${conversations.length} conversations`);
        }
      }
    }
    
    console.log(`  ✅ Migrated ${migratedCount} conversations successfully`);
    
    // Make columns NOT NULL after migration
    console.log('\n🔧 Setting columns to NOT NULL...');
    
    try {
      await dataSource.query(`
        ALTER TABLE conversation 
        ALTER COLUMN "participantOneId" SET NOT NULL,
        ALTER COLUMN "participantTwoId" SET NOT NULL
      `);
      console.log('✅ Columns set to NOT NULL');
    } catch (err: any) {
      console.log('⚠️ Could not set NOT NULL constraint:', err?.message);
    }
    
    console.log('\n✅ Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Error during migration:', error);
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

migrateConversationData();