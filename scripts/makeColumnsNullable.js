const { Client } = require('pg');

const databaseUrl = "postgres://postgres:YJipgXJuVLMLihCnMQjZN6CuesyXLPSFWadd3t9ec0gsR6YSt2K8iILqyhpBZ65a@168.231.79.158:5432/postgres";

async function makeColumnsNullable() {
  const client = new Client({
    connectionString: databaseUrl,
    ssl: false,
  });

  try {
    await client.connect();

    // Make studentId and instructorId columns nullable
    
    await client.query(`
      ALTER TABLE conversation 
      ALTER COLUMN "studentId" DROP NOT NULL,
      ALTER COLUMN "instructorId" DROP NOT NULL
    `);
    
    
    // Verify the change
    const result = await client.query(`
      SELECT column_name, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'conversation' 
      AND column_name IN ('studentId', 'instructorId')
    `);
    
    result.rows.forEach(row => {
    });
    
    
  } catch (error) {
  } finally {
    await client.end();
  }
}

makeColumnsNullable();