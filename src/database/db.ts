import { DataSource } from 'typeorm';
import dotenv from 'dotenv';
dotenv.config();

export class DbConnection {
  private static _instance: DbConnection;
  private static dbConnection = new DataSource({
    type: 'postgres',
    logging: false,
    ssl: false, // Coolify PostgreSQL has SSL disabled
    synchronize: true,
    url: process.env.DATABASE_URL,
    migrations: [__dirname + '/migrations/'],
    entities: [__dirname + '/models/*{.js,.ts}'],
  });

  private constructor() {}

  public static get instance(): DbConnection {
    if (!this._instance) this._instance = new DbConnection();
    return this._instance;
  }

  public static get connection(): DataSource {
    return this.dbConnection;
  }

  initializeDb = async () => {
    try {
      await DbConnection.dbConnection.initialize();
      console.log('✅ Database connected successfully');
    } catch (error) {
      console.error('❌ Database initialization error:', error);
      throw error; // throw so server startup fails loudly
    }
  };

  disconnectDb = async () => {
    try {
      await DbConnection.dbConnection.destroy();
      console.log('✅ Database connection closed');
    } catch (error) {
      console.error('❌ Database disconnect error:', error);
    }
  };
}

const dbConnection = DbConnection.connection;
export default dbConnection;