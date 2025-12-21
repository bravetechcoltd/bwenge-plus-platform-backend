const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const databaseUrl = "postgres://postgres:YJipgXJuVLMLihCnMQjZN6CuesyXLPSFWadd3t9ec0gsR6YSt2K8iILqyhpBZ65a@168.231.79.158:5432/postgres";

async function runMigration() {
  const client = new Client({
    connectionString: databaseUrl,
    ssl: false, // Disable SSL since it's a local/internal connection
  });

  try {
    console.log('🔄 Connecting to database...');
    await client.connect();
    console.log('✅ Connected to database');

    // Read the SQL file
    const sqlFilePath = path.join(__dirname, 'directMigration.sql');
    
    if (!fs.existsSync(sqlFilePath)) {
      console.error(`❌ SQL file not found: ${sqlFilePath}`);
      process.exit(1);
    }
    
    const sql = fs.readFileSync(sqlFilePath, 'utf8');
    console.log(`📝 Read SQL file (${sql.length} characters)`);

    // Split SQL statements (handles semicolons properly)
    const statements = sql.split(';').filter(stmt => stmt.trim().length > 0 && !stmt.trim().startsWith('--'));
    
    console.log(`📝 Running ${statements.length} SQL statements...\n`);

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i].trim();
      if (stmt) {
        try {
          await client.query(stmt);
          console.log(`  ✅ [${i + 1}/${statements.length}] Executed: ${stmt.substring(0, 60)}...`);
          successCount++;
        } catch (err) {
          console.log(`  ⚠️ [${i + 1}/${statements.length}] Error: ${err.message}`);
          console.log(`     Statement: ${stmt.substring(0, 100)}`);
          errorCount++;
          // Continue with other statements even if one fails
        }
      }
    }

    console.log(`\n📊 Migration Summary:`);
    console.log(`   ✅ Successful: ${successCount}`);
    console.log(`   ⚠️ Errors: ${errorCount}`);
    console.log(`   Total: ${statements.length}`);
    
    console.log('\n✅ SQL migration completed');
    
  } catch (error) {
    console.error('❌ Error during migration:', error);
  } finally {
    await client.end();
    console.log('📦 Database connection closed');
  }
}

runMigration();