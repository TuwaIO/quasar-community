import * as migration_20260908_125833_init from './20260908_125833_init';
import * as migration_20260925_080001_schema_integrity from './20260925_080001_schema_integrity';

export const migrations = [
  {
    up: migration_20260908_125833_init.up,
    down: migration_20260908_125833_init.down,
    name: '20260908_125833_init',
  },
  {
    up: migration_20260925_080001_schema_integrity.up,
    down: migration_20260925_080001_schema_integrity.down,
    name: '20260925_080001_schema_integrity'
  },
];
