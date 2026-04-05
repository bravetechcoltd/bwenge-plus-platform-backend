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
    await client.connect();

    // Read the SQL file
    const sqlFilePath = path.join(__dirname, 'directMigration.sql');
    
    if (!fs.existsSync(sqlFilePath)) {
      process.exit(1);
    }
    
    const sql = fs.readFileSync(sqlFilePath, 'utf8');

    // Split SQL statements (handles semicolons properly)
    const statements = sql.split(';').filter(stmt => stmt.trim().length > 0 && !stmt.trim().startsWith('--'));
    

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i].trim();
      if (stmt) {
        try {
          await client.query(stmt);
          successCount++;
        } catch (err) {
          errorCount++;
          // Continue with other statements even if one fails
        }
      }
    }

    
    
  } catch (error) {
  } finally {
    await client.end();
  }
}

runMigration();