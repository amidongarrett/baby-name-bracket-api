const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * BabyName Schema
 * Static catalog of curated baby names tagged by gender.
 * Used by the name generator feature on the bracket page.
 */
const BabyNameSchema = new mongoose.Schema({
  id: {
    type: String,
    default: uuidv4,
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  gender: {
    type: String,
    enum: ['girl', 'boy', 'neutral'],
    required: true
  }
});

module.exports = mongoose.model('BabyName', BabyNameSchema);
