import 'reflect-metadata';
import { DataSource } from 'typeorm';
import dotenv from 'dotenv';
dotenv.config();

async function finalCleanup() {
  const dataSource = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    synchronize: false,
    logging: true,
  });

  try {
    await dataSource.initialize();

    // Get all tables
    const tables = ['conversation', 'space', 'message', 'space_message', 'space_member'];
    
    for (const table of tables) {
      
      // Get all indexes for the table
      const indexes = await dataSource.query(`
        SELECT indexname, indexdef 
        FROM pg_indexes 
        WHERE tablename = '${table}'
      `);
      
      
      for (const idx of indexes) {
        // Skip primary key indexes
        if (idx.indexname.includes('pkey') || idx.indexdef.includes('PRIMARY KEY')) {
          continue;
        }
        
        // Skip unique constraints that are not causing issues
        if (idx.indexname.includes('UQ_') && !idx.indexname.includes('333423eb8599228680261054462')) {
          continue;
        }
        
        
        // Check if this is a problematic index
        const problematicPatterns = ['IDX_16a9af5352d00170944c4cdf3b', 'IDX_5d4fd47a9f15f3f8134a5f4502'];
        const isProblematic = problematicPatterns.some(pattern => idx.indexname.includes(pattern));
        
        if (isProblematic) {
          try {
            await dataSource.query(`DROP INDEX IF EXISTS "${idx.indexname}"`);
          } catch (err: any) {
          }
        }
      }
    }
    
    
  } catch (error) {
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

finalCleanup();