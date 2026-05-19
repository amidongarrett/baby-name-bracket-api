const mongoose = require('mongoose');

const PicksSchema = new mongoose.Schema({
  roundOf32:    { type: [String], default: () => Array(16).fill(null) },
  roundOf16:    { type: [String], default: () => Array(8).fill(null) },
  elite8:       { type: [String], default: () => Array(4).fill(null) },
  final4:       { type: [String], default: () => Array(2).fill(null) },
  championship: { type: [String], default: () => Array(1).fill(null) },
}, { _id: false });

const UserBracketSchema = new mongoose.Schema({
  bracketId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Bracket' },
  userId:    { type: String, required: true },
  picks:     { type: PicksSchema, default: () => ({}) },
  score:     { type: Number, default: 0 },
  lockedAt:  { type: Date, default: null },
}, { timestamps: true });

UserBracketSchema.index({ bracketId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('UserBracket', UserBracketSchema);
