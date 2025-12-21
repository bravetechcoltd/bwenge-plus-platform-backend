import NodeCache from 'node-cache';
import Redis from 'ioredis';

interface CacheOptions {
  ttl?: number; // Time to live in seconds
  useRedis?: boolean;
}

class CacheService {
  private memoryCache: NodeCache;
  private redisClient: Redis | null = null;
  private useRedis: boolean = false;
  private readonly DEFAULT_TTL = 3600; // 1 hour

  constructor() {
    // Initialize memory cache
    this.memoryCache = new NodeCache({
      stdTTL: this.DEFAULT_TTL,
      checkperiod: 120,
      useClones: false,
    });

    // Try to initialize Redis if configured
    if (process.env.REDIS_URL) {
      try {
        this.redisClient = new Redis(process.env.REDIS_URL, {
          lazyConnect: true,
          retryStrategy: (times) => {
            const delay = Math.min(times * 50, 2000);
            return delay;
          },
        });

        this.redisClient.on('connect', () => {
          console.log('✅ Redis cache connected');
          this.useRedis = true;
        });

        this.redisClient.on('error', (err) => {
          console.warn('⚠️ Redis connection failed, falling back to memory cache:', err.message);
          this.useRedis = false;
        });

        // Attempt connection (don't wait)
        this.redisClient.connect().catch(() => {
          this.useRedis = false;
        });
      } catch (error) {
        console.warn('⚠️ Redis initialization failed, using memory cache only');
        this.useRedis = false;
      }
    } else {
      console.log('📦 Using in-memory cache (REDIS_URL not configured)');
    }
  }

  /**
   * Get a value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      if (this.useRedis && this.redisClient) {
        const value = await this.redisClient.get(key);
        return value ? JSON.parse(value) : null;
      } else {
        return this.memoryCache.get<T>(key) || null;
      }
    } catch (error) {
      console.error(`❌ Cache get error for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Set a value in cache
   */
  async set(key: string, value: any, options: CacheOptions = {}): Promise<boolean> {
    const ttl = options.ttl || this.DEFAULT_TTL;
    
    try {
      if (this.useRedis && this.redisClient) {
        await this.redisClient.set(key, JSON.stringify(value), 'EX', ttl);
      } else {
        this.memoryCache.set(key, value, ttl);
      }
      return true;
    } catch (error) {
      console.error(`❌ Cache set error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Delete a value from cache
   */
  async del(key: string): Promise<boolean> {
    try {
      if (this.useRedis && this.redisClient) {
        await this.redisClient.del(key);
      } else {
        this.memoryCache.del(key);
      }
      return true;
    } catch (error) {
      console.error(`❌ Cache delete error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Delete multiple keys by pattern
   */
  async delPattern(pattern: string): Promise<number> {
    let deletedCount = 0;
    
    try {
      if (this.useRedis && this.redisClient) {
        const keys = await this.redisClient.keys(pattern);
        if (keys.length > 0) {
          deletedCount = await this.redisClient.del(...keys);
        }
      } else {
        const keys = this.memoryCache.keys();
        const regex = new RegExp(pattern.replace('*', '.*'));
        keys.forEach(key => {
          if (regex.test(key)) {
            this.memoryCache.del(key);
            deletedCount++;
          }
        });
      }
    } catch (error) {
      console.error(`❌ Cache delPattern error for pattern ${pattern}:`, error);
    }
    
    return deletedCount;
  }

  /**
   * Check if key exists
   */
  async has(key: string): Promise<boolean> {
    try {
      if (this.useRedis && this.redisClient) {
        return await this.redisClient.exists(key) === 1;
      } else {
        return this.memoryCache.has(key);
      }
    } catch (error) {
      console.error(`❌ Cache has error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Get multiple values
   */
  async getMany<T>(keys: string[]): Promise<(T | null)[]> {
    try {
      if (this.useRedis && this.redisClient) {
        const values = await this.redisClient.mget(keys);
        return values.map(v => v ? JSON.parse(v) : null);
      } else {
        return keys.map(key => this.memoryCache.get<T>(key) || null);
      }
    } catch (error) {
      console.error('❌ Cache getMany error:', error);
      return keys.map(() => null);
    }
  }

  /**
   * Set multiple values
   */
  async setMany(entries: { key: string; value: any; ttl?: number }[]): Promise<boolean> {
    try {
      if (this.useRedis && this.redisClient) {
        const pipeline = this.redisClient.pipeline();
        entries.forEach(({ key, value, ttl = this.DEFAULT_TTL }) => {
          pipeline.set(key, JSON.stringify(value), 'EX', ttl);
        });
        await pipeline.exec();
      } else {
        entries.forEach(({ key, value, ttl = this.DEFAULT_TTL }) => {
          this.memoryCache.set(key, value, ttl);
        });
      }
      return true;
    } catch (error) {
      console.error('❌ Cache setMany error:', error);
      return false;
    }
  }

  /**
   * Get cache stats
   */
  async getStats(): Promise<any> {
    if (this.useRedis && this.redisClient) {
      const info = await this.redisClient.info();
      const stats: any = {};
      
      // Parse Redis info
      const lines = info.split('\r\n');
      lines.forEach(line => {
        if (line.includes(':')) {
          const [key, value] = line.split(':');
          stats[key] = value;
        }
      });
      
      return {
        type: 'redis',
        stats,
        keys: await this.redisClient.dbsize(),
      };
    } else {
      return {
        type: 'memory',
        stats: this.memoryCache.getStats(),
        keys: this.memoryCache.keys().length,
      };
    }
  }

  /**
   * Clear all cache
   */
  async clear(): Promise<boolean> {
    try {
      if (this.useRedis && this.redisClient) {
        await this.redisClient.flushdb();
      } else {
        this.memoryCache.flushAll();
      }
      return true;
    } catch (error) {
      console.error('❌ Cache clear error:', error);
      return false;
    }
  }

  /**
   * Get or set cache with function
   */
  async remember<T>(
    key: string,
    callback: () => Promise<T>,
    ttl: number = this.DEFAULT_TTL
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const value = await callback();
    await this.set(key, value, { ttl });
    return value;
  }
}

// Export singleton instance
export const cacheService = new CacheService();