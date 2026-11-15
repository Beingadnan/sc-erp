import { describe, expect, it } from 'vitest';
import { redisConnectionFromUrl } from '../src/redis.js';

describe('redisConnectionFromUrl', () => {
  it('parses plain and TLS urls', () => {
    expect(redisConnectionFromUrl('redis://localhost:6379')).toMatchObject({
      host: 'localhost',
      port: 6379,
      db: 0,
    });
    expect(
      redisConnectionFromUrl('rediss://default:p%40ss@cache.example.com:6380/2'),
    ).toMatchObject({
      host: 'cache.example.com',
      port: 6380,
      username: 'default',
      password: 'p@ss',
      db: 2,
      tls: {},
    });
  });
});
