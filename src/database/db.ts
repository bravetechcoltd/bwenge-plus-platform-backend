// @ts-nocheck
import { DataSource } from 'typeorm';
import dotenv from 'dotenv';
import path from 'path';
dotenv.config();

export class DbConnection {
  private static _instance: DbConnection;
  private static _dataSource: DataSource | null = null;

  private constructor() {}

  public static get instance(): DbConnection {
    if (!this._instance) this._instance = new DbConnection();
    return this._instance;
  }

  public static get connection(): DataSource {
    if (!this._dataSource) {
      this._dataSource = new DataSource({
        type: 'postgres',
        url: process.env.DATABASE_URL,
        synchronize: false,
        logging: process.env.NODE_ENV === 'development',
        entities: [path.join(__dirname, 'models', '*.{js,ts}')],
        migrations: [path.join(__dirname, 'migrations', '*.{js,ts}')],
        migrationsRun: false,
      });
    }
    return this._dataSource;
  }

  initializeDb = async () => {
    try {
      const ds = DbConnection.connection;

      if (!ds.isInitialized) {
        await ds.initialize();
        console.log('✅ Database connected successfully');
        console.log('⚠️  Auto-synchronization is disabled. Running pending migrations...');

        // Auto-run pending migrations on startup
        const pending = await ds.showMigrations();
        if (pending) {
          await ds.runMigrations({ transaction: 'each' });
          console.log('✅ Migrations applied successfully');
        } else {
          console.log('✅ Database schema is up to date');
        }
      }

      return ds;
    } catch (error) {
      console.error('❌ Database initialization error:', error);
      throw error;
    }
  };

  disconnectDb = async () => {
    try {
      const ds = DbConnection._dataSource;
      if (ds && ds.isInitialized) {
        await ds.destroy();
        console.log('✅ Database connection closed');
      }
    } catch (error) {
      console.error('❌ Database disconnect error:', error);
    }
  };
}

export default DbConnection.connection;