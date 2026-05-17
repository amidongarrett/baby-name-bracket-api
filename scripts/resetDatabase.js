/**
 * Database Reset Script
 * Clears all brackets from the database to fix corruption issues
 * 
 * Run with: node scripts/resetDatabase.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Bracket = require('../models/Bracket');

async function resetDatabase() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/babynames');
    
    console.log('✅ Connected to MongoDB');
    console.log('🗑️  Deleting all brackets...');
    
    // Delete all brackets
    const result = await Bracket.deleteMany({});
    
    console.log(`✅ Deleted ${result.deletedCount} bracket(s)`);
    console.log('🎉 Database reset complete!');
    console.log('');
    console.log('The next API request will automatically create a fresh, empty bracket.');
    
    // Close connection
    await mongoose.connection.close();
    console.log('👋 Database connection closed');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error resetting database:', error);
    process.exit(1);
  }
}

resetDatabase();
