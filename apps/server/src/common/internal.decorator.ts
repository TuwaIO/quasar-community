import { SetMetadata } from '@nestjs/common';

export const IS_INTERNAL_ONLY_KEY = 'isInternalOnly';
export const InternalOnly = () => SetMetadata(IS_INTERNAL_ONLY_KEY, true);
