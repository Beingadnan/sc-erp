import { apiEnvSchema, parseEnv } from '@school-erp/validation';
import type { ApiEnv } from '@school-erp/validation';

export const API_CONFIG = Symbol('API_CONFIG');
export type ApiConfig = ApiEnv;

export const loadApiConfig = (env: NodeJS.ProcessEnv = process.env): ApiConfig =>
  parseEnv(apiEnvSchema, env);
