import 'reflect-metadata';
import { DataSource } from 'typeorm';
import dotenv from 'dotenv';
dotenv.config();

async function cleanupAllIndexes() {
  const dataSource = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    synchronize: false,
    logging: true,
  });

  try {
    await dataSource.initialize();
    console.log('✅ Connected to database');

    // Get all indexes for the relevant tables
    const tables = ['conversation', 'space', 'message', 'space_message', 'space_member'];
    
    for (const table of tables) {
      try {
        // Get all indexes for the table
        const indexes = await dataSource.query(`
          SELECT indexname 
          FROM pg_indexes 
          WHERE tablename = '${table}' 
          AND indexname NOT LIKE '%pkey%'
        `);
        
        console.log(`\n📊 Found ${indexes.length} indexes on table ${table}:`);
        
        // Drop each index
        for (const idx of indexes) {
          try {
            await dataSource.query(`DROP INDEX IF EXISTS "${idx.indexname}" CASCADE`);
            console.log(`  ✅ Dropped index: ${idx.indexname}`);
          } catch (err) {
            console.log(`  ⚠️ Could not drop index: ${idx.indexname}`);
          }
        }
      } catch (err) {
        console.log(`⚠️ Table ${table} may not exist yet`);
      }
    }

    console.log('\n✅ All indexes cleaned up successfully');
    
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

cleanupAllIndexes();