import { config } from './config';
import { Pool } from 'pg';

const pool = new Pool({
    connectionString: config.databaseUrl,
});

export default pool;