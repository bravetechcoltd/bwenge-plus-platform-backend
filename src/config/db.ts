import dotenv from 'dotenv';
dotenv.config();

type envData = {
  username?: string;
  password?: string;
  host?: string;
  port?: string;
  name?: string;
  ssl?: boolean | {
    require: boolean;
    rejectUnauthorized: boolean;
  };
};

const env = process.env.NODE_ENV || 'development';

const development = {
  username: process.env.DB_USER_DEV,
  password: process.env.DB_PASSWORD_DEV,
  host: process.env.DB_HOST_DEV,
  port: process.env.DB_PORT_DEV,
  name: process.env.DB_NAME_DEV,
  ssl: false // Coolify PostgreSQL has SSL disabled
};

const staging = {
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  name: process.env.DB_NAME_DEV,
  ssl: false
};

const production = {
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  name: process.env.DB_NAME_DEV,
  ssl: false // Coolify internal network, SSL not needed
};

const config: {
  [key: string]: envData;
} = {
  development,
  staging,
  production,
};

export default config[env];