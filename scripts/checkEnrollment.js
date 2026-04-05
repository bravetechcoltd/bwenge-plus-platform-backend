const { Client } = require('pg');

const databaseUrl = "postgres://postgres:YJipgXJuVLMLihCnMQjZN6CuesyXLPSFWadd3t9ec0gsR6YSt2K8iILqyhpBZ65a@168.231.79.158:5432/postgres";

async function checkEnrollment() {
  const client = new Client({
    connectionString: databaseUrl,
    ssl: false,
  });

  try {
    await client.connect();

    const courseId = '7f098145-954e-44c9-b2ca-4d49d3afed78';
    const userId = '948678ad-aba1-4fe5-ac47-f341b4e41351';

    // Check enrollment
    const result = await client.query(`
      SELECT 
        id,
        user_id,
        course_id,
        status,
        approval_status,
        requires_approval,
        enrolled_at,
        updated_at
      FROM enrollments 
      WHERE course_id = $1 AND user_id = $2
    `, [courseId, userId]);

    if (result.rows.length === 0) {
    } else {
      
      // Show all possible status values from the enum
      const enumValues = await client.query(`
        SELECT enum_range(NULL::enrollments_status_enum) as status_values
      `);
      
      const approvalValues = await client.query(`
        SELECT enum_range(NULL::enrollments_approval_status_enum) as approval_values
      `);
    }
    
  } catch (error) {
  } finally {
    await client.end();
  }
}

checkEnrollment();