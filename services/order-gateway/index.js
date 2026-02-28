require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const orderRoutes = require('./routes/orderRoutes');

const app = express();
const PORT = process.env.PORT || 5002;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/order_gateway';

app.use(express.json());
app.use(cors());

// Connect to MongoDB
mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.error('Error connecting to MongoDB', err));

// Routes
app.use('/api/orders', orderRoutes);

// Basic health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', service: 'order-gateway' });
});

app.listen(PORT, () => {
    console.log(`Order Gateway service running on port ${PORT}`);
});
