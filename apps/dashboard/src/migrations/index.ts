import * as migration_20260908_125833_init from './20260908_125833_init';
import * as migration_20260925_080001_schema_integrity from './20260925_080001_schema_integrity';
import * as migration_20261002_220058_payload_3_90 from './20261002_220058_payload_3_90';
import * as migration_20261003_071000_solana_caip2_chain_ids from './20261003_071000_solana_caip2_chain_ids';

export const migrations = [
  {
    up: migration_20260908_125833_init.up,
    down: migration_20260908_125833_init.down,
    name: '20260908_125833_init',
  },
  {
    up: migration_20260925_080001_schema_integrity.up,
    down: migration_20260925_080001_schema_integrity.down,
    name: '20260925_080001_schema_integrity',
  },
  {
    up: migration_20261002_220058_payload_3_90.up,
    down: migration_20261002_220058_payload_3_90.down,
    name: '20261002_220058_payload_3_90',
  },
  {
    up: migration_20261003_071000_solana_caip2_chain_ids.up,
    down: migration_20261003_071000_solana_caip2_chain_ids.down,
    name: '20261003_071000_solana_caip2_chain_ids'
  },
];
