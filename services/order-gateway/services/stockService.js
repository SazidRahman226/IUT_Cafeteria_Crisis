const axios = require('axios');
const redis = require('redis');

const STOCK_SERVICE_URL = process.env.STOCK_SERVICE_URL || 'http://stock-service:5003/api/stock';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Initialize Redis Client
const redisClient = redis.createClient({
  url: REDIS_URL
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));

// Connect to Redis immediately
let isRedisConnected = false;
(async () => {
    try {
        await redisClient.connect();
        isRedisConnected = true;
        console.log('Connected to Redis');
    } catch (err) {
        console.warn('Failed to connect to Redis. Proceeding without cache.', err.message);
    }
})();


const checkStock = async (productId) => {
  try {
    // 1. Check Redis Cache
    const cacheKey = `stock:${productId}`;
    let cachedStock = null;

    if (isRedisConnected) {
        try {
            cachedStock = await redisClient.get(cacheKey);
            if (cachedStock !== null) {
                console.log(`Cache hit for product ${productId}`);
                return JSON.parse(cachedStock);
            }
        } catch (e) {
            console.warn(`Redis get error for product ${productId}:`, e.message);
        }
    }

    // 2. Cache Miss - Fetch from Stock Service
    if (isRedisConnected) {
        console.log(`Cache miss for product ${productId}. Fetching from stock-service...`);
    } else {
        console.log(`Redis disconnected. Fetching product ${productId} from stock-service directly...`);
    }

    let stockData;
    try {
        const response = await axios.get(`${STOCK_SERVICE_URL}/${productId}`);
        if (response.status === 200) {
           stockData = response.data;
        } else {
           throw new Error(`Status Code: ${response.status}`);
        }
    } catch (e) {
      if (e.code === 'ECONNREFUSED') {
          console.warn(`Stock service is down. Simulated fallback for local testing: productId=${productId} has 10 items.`);
          stockData = { productId, count: 10 }; // Fallback Mock
      } else {
          throw e; // Rethrow actual error
      }
    }
    
    // 3. Update Redis Cache (set expiry to e.g., 60 seconds)
    if (isRedisConnected && stockData) {
        try {
            await redisClient.setEx(cacheKey, 60, JSON.stringify(stockData));
        } catch (e) {
            console.warn(`Redis set error for product ${productId}:`, e.message);
        }
    }
      
    return stockData;
  } catch (error) {
    console.error(`Error checking stock for productId ${productId}:`, error.message);
    throw error;
  }
};

module.exports = {
  checkStock,
  redisClient
};
