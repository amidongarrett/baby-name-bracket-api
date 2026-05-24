'use strict';

const mongoose = require('mongoose');

const UserNamePreferencesSchema = new mongoose.Schema({
  userId:    { type: String, required: true },
  bracketId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Bracket' },
  dismissedNames: [{ type: String }],
  bankNames: [{ name: String, note: String }],
}, { timestamps: true });

UserNamePreferencesSchema.index({ bracketId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('UserNamePreferences', UserNamePreferencesSchema);
