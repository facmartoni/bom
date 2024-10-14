import Redis from "ioredis";

class RedisController {
  constructor() {
    this.client = new Redis(process.env.REDIS_URL);
  }

  async get(key) {
    return await this.client.get(key);
  }

  async set(key, value) {
    return await this.client.set(key, value);
  }

  async del(key) {
    return await this.client.del(key);
  }

  async keys(pattern) {
    return await this.client.keys(pattern);
  }

  async incr(key) {
    return await this.client.incr(key);
  }

  async decr(key) {
    return await this.client.decr(key);
  }
}

const redisController = new RedisController();
export default redisController;
