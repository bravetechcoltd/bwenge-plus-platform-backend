import 'reflect-metadata';
import { DataSource } from 'typeorm';
import dotenv from 'dotenv';
dotenv.config();

async function cleanupSpecificIndexes() {
  const dataSource = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    synchronize: false,
    logging: true,
  });

  try {
    await dataSource.initialize();
    console.log('✅ Connected to database');

    // List of indexes that are causing problems (non-PK indexes)
    const indexesToDrop = [
      { table: 'space', name: 'IDX_16a9af5352d00170944c4cdf3b' },
      { table: 'space', name: 'IDX_space_courseId' },
      { table: 'space', name: 'IDX_space_institutionId' },
      { table: 'conversation', name: 'IDX_5d4fd47a9f15f3f8134a5f4502' },
      { table: 'conversation', name: 'IDX_conversation_participantOneId' },
      { table: 'conversation', name: 'IDX_conversation_participantTwoId' },
      { table: 'conversation', name: 'IDX_conversation_institutionId' },
      { table: 'conversation', name: 'IDX_conversation_courseId' },
      { table: 'message', name: 'IDX_e330398c18c7d9696967901f16' },
      { table: 'space_message', name: 'IDX_7de1443208ed741853efc4a81a' },
    ];
    
    console.log('🗑️  Dropping problematic indexes...\n');
    
    for (const idx of indexesToDrop) {
      try {
        // Check if index exists
        const exists = await dataSource.query(`
          SELECT EXISTS (
            SELECT 1 FROM pg_indexes 
            WHERE indexname = '${idx.name}'
          );
        `);
        
        if (exists[0].exists) {
          await dataSource.query(`DROP INDEX IF EXISTS "${idx.name}"`);
          console.log(`  ✅ Dropped index: ${idx.name}`);
        } else {
          console.log(`  ⏭️  Index ${idx.name} does not exist, skipping`);
        }
      } catch (err: any) {
        if (err.message?.includes('cannot drop index')) {
          console.log(`  ⚠️ Cannot drop index ${idx.name} (likely a primary key), skipping`);
        } else {
          console.log(`  ⚠️ Error dropping ${idx.name}:`, err.message);
        }
      }
    }
    
    console.log('\n✅ Index cleanup completed');
    
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

cleanupSpecificIndexes();