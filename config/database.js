/**
 * MongoDB Database Connection Utility
 * Handles connection lifecycle, error handling, and configuration
 */

const mongoose = require('mongoose');

/**
 * MongoDB Connection State
 */
let isConnected = false;

/**
 * Connect to MongoDB using environment configuration
 * @returns {Promise<void>}
 */
const connectDB = async () => {
  // Prevent multiple connections
  if (isConnected) {
    console.log('📊 MongoDB: Using existing connection');
    return;
  }

  // Validate environment variable
  const MONGODB_URI = process.env.MONGODB_URI;
  
  if (!MONGODB_URI) {
    throw new Error(
      'MONGODB_URI is not defined in environment variables. ' +
      'Please set MONGODB_URI in your .env file.'
    );
  }

  try {
    // Connection options for mongoose
    const options = {
      serverSelectionTimeoutMS: 5000,  // Timeout after 5 seconds
      socketTimeoutMS: 45000,          // Close sockets after 45 seconds of inactivity
    };

    // Connect to MongoDB
    const conn = await mongoose.connect(MONGODB_URI, options);

    isConnected = true;
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📊 MongoDB Connected: ${conn.connection.host}`);
    console.log(`📦 Database: ${conn.connection.name}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  } catch (error) {
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ MongoDB Connection Error:');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error(`Error Name: ${error.name}`);
    console.error(`Error Message: ${error.message}`);
    
    if (error.name === 'MongooseServerSelectionError') {
      console.error('\n💡 Troubleshooting Tips:');
      console.error('   1. Check if MongoDB is running locally');
      console.error('   2. Verify MONGODB_URI in your .env file');
      console.error('   3. Ensure network connectivity if using cloud database');
      console.error('   4. Check firewall settings and IP whitelist');
    }
    
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // Exit process with failure
    process.exit(1);
  }
};

/**
 * Disconnect from MongoDB gracefully
 * @returns {Promise<void>}
 */
const disconnectDB = async () => {
  if (!isConnected) {
    return;
  }

  try {
    await mongoose.connection.close();
    isConnected = false;
    console.log('📊 MongoDB: Connection closed gracefully');
  } catch (error) {
    console.error('❌ Error closing MongoDB connection:', error.message);
    throw error;
  }
};

/**
 * Get current connection status
 * @returns {boolean}
 */
const getConnectionStatus = () => {
  return isConnected && mongoose.connection.readyState === 1;
};

// Connection event handlers
mongoose.connection.on('connected', () => {
  console.log('📊 Mongoose: Connection established');
});

mongoose.connection.on('error', (err) => {
  console.error('❌ Mongoose connection error:', err.message);
});

mongoose.connection.on('disconnected', () => {
  console.log('📊 Mongoose: Connection disconnected');
  isConnected = false;
});

// Handle process termination
process.on('SIGINT', async () => {
  await mongoose.connection.close();
  console.log('📊 MongoDB: Connection closed through app termination');
  process.exit(0);
});

module.exports = {
  connectDB,
  disconnectDB,
  getConnectionStatus
};
