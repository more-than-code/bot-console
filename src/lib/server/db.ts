import { existsSync } from 'node:fs';
import { env } from '$env/dynamic/private';
import postgres, { type Sql } from 'postgres';

const ENV_KEYS = ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'] as const;

/**
 * Dev bakes `.env` into `$env/dynamic/private`. `node build` only sees variables
 * that already exist when the process starts, so load `.env` here when one is
 * missing. `loadEnvFile` does not override, so a systemd EnvironmentFile wins.
 */
function ensureEnvFile(): void {
	if (ENV_KEYS.every((key) => process.env[key])) return;
	if (!existsSync('.env')) return;
	try {
		process.loadEnvFile('.env');
	} catch {
		throw new Error('Could not read .env');
	}
}

function required(name: (typeof ENV_KEYS)[number]): string {
	ensureEnvFile();
	const value = env[name] || process.env[name];
	if (!value) throw new Error(`Missing environment variable ${name}`);
	return value;
}

const globalForDb = globalThis as typeof globalThis & { __pimSql?: Sql };

export function getSql(): Sql {
	if (!globalForDb.__pimSql) {
		ensureEnvFile();
		const port = Number(required('PGPORT'));
		if (!Number.isInteger(port) || port < 1 || port > 65535) {
			throw new Error('Invalid PGPORT');
		}
		globalForDb.__pimSql = postgres({
			host: required('PGHOST'),
			port,
			database: required('PGDATABASE'),
			username: required('PGUSER'),
			password: required('PGPASSWORD'),
			max: 4,
			idle_timeout: 20,
			max_lifetime: 60 * 30,
			connect_timeout: 10,
			connection: {
				application_name: 'bot-console',
				statement_timeout: 15000,
				default_transaction_read_only: true,
				TimeZone: 'UTC'
			}
		});
	}
	return globalForDb.__pimSql;
}
