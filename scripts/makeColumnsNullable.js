const { Client } = require('pg');

const databaseUrl = "postgres://postgres:YJipgXJuVLMLihCnMQjZN6CuesyXLPSFWadd3t9ec0gsR6YSt2K8iILqyhpBZ65a@168.231.79.158:5432/postgres";

async function makeColumnsNullable() {
  const client = new Client({
    connectionString: databaseUrl,
    ssl: false,
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // Make studentId and instructorId columns nullable
    console.log('🔧 Making studentId and instructorId columns nullable...');
    
    await client.query(`
      ALTER TABLE conversation 
      ALTER COLUMN "studentId" DROP NOT NULL,
      ALTER COLUMN "instructorId" DROP NOT NULL
    `);
    
    console.log('✅ Columns updated to be nullable');
    
    // Verify the change
    const result = await client.query(`
      SELECT column_name, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'conversation' 
      AND column_name IN ('studentId', 'instructorId')
    `);
    
    console.log('\n📊 Column status:');
    result.rows.forEach(row => {
      console.log(`  ${row.column_name}: is_nullable = ${row.is_nullable}`);
    });
    
    console.log('\n✅ Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

makeColumnsNullable();