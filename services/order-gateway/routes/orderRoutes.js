const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const { checkStock } = require('../services/stockService');
const authMiddleware = require('../middleware/authMiddleware');

// 1. Placing an order (Protected by authMiddleware)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { productIds } = req.body;
    
    // Using user info attached by authMiddleware
    const userId = req.user.id || req.user._id;

    if (!userId || !productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ error: 'Valid userId and a non-empty list of productIds are required' });
    }

    // Checking stock for each product
    const stockChecks = Object.fromEntries(
        await Promise.all(
            productIds.map(async (productId) => {
                try {
                    const stock = await checkStock(productId);
                    return [productId, { inStock: true, data: stock }];
                } catch (error) {
                    return [productId, { inStock: false, error: 'Failed to verify stock' }];
                }
            })
        )
    );

    const outOfStockItems = Object.keys(stockChecks).filter(id => !stockChecks[id].inStock);
    if(outOfStockItems.length > 0) {
        return res.status(400).json({
            error: 'Some items are out of stock or failed to verify',
            details: outOfStockItems
        });
    }

    // Creating the order
    const order = new Order({
      userId,
      productIds,
      status: 'Pending'
    });

    await order.save();

    res.status(201).json({ message: 'Order created successfully', orderId: order._id });
  } catch (error) {
    console.error('Error placing order:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 2. Additional Route: Client directly checking stock via gateway
router.get('/stock/:productId', async (req, res) => {
  try {
    const stockInfo = await checkStock(req.params.productId);
    res.json(stockInfo);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve stock info' });
  }
});

module.exports = router;
