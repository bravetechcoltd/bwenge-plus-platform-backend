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
        
        
        // Drop each index
        for (const idx of indexes) {
          try {
            await dataSource.query(`DROP INDEX IF EXISTS "${idx.indexname}" CASCADE`);
          } catch (err) {
          }
        }
      } catch (err) {
      }
    }

    
  } catch (error) {
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

cleanupAllIndexes();