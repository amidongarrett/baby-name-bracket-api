const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * Name Schema
 * Represents an individual baby name submission
 */
const NameSchema = new mongoose.Schema({
  id: {
    type: String,
    default: uuidv4,
    required: true
  },
  value: {
    type: String,
    required: true,
    trim: true
  },
  submittedBy: {
    type: String,
    enum: ['Owner 1', 'Owner 2'],
    required: true
  },
  isShared: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

/**
 * Vote Schema
 * Represents a single vote cast by a guest user
 */
const VoteSchema = new mongoose.Schema({
  id: {
    type: String,
    default: uuidv4,
    required: true
  },
  matchupId: {
    type: String,
    required: true
  },
  voterId: {
    type: String,
    required: true
  },
  selectedNameId: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

/**
 * Matchup Schema
 * Represents a single bracket matchup between two names
 */
const MatchupSchema = new mongoose.Schema({
  id: {
    type: String,
    default: uuidv4,
    required: true
  },
  round: {
    type: String,
    enum: ['Round of 32', 'Round of 16', 'Elite 8', 'Final 4', 'Championship'],
    required: true
  },
  name1Id: {
    type: String,
    required: false,
    default: null
  },
  name2Id: {
    type: String,
    required: false,
    default: null
  },
  votes: {
    name1Votes: {
      type: Number,
      default: 0,
      min: 0
    },
    name2Votes: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  winnerId: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

/**
 * Bracket Schema
 * Main schema that represents the entire tournament bracket
 * Stores individual lists, sequential rankings, and shared favorites
 */
const BracketSchema = new mongoose.Schema({
  // Bracket metadata
  name: {
    type: String,
    required: true,
    default: 'Baby Name March Madness'
  },
  status: {
    type: String,
    enum: ['draft', 'active', 'completed'],
    default: 'draft'
  },
  owner1LockedIn: { type: Boolean, default: false },
  owner2LockedIn: { type: Boolean, default: false },
  currentRound: {
    type: String,
    enum: ['Round of 32', 'Round of 16', 'Elite 8', 'Final 4', 'Championship', 'Completed'],
    default: 'Round of 32'
  },
  
  // Individual name lists organized by owner
  owner1Names: {
    type: [NameSchema],
    validate: {
      validator: function(names) {
        return names.length <= 16;
      },
      message: 'Owner 1 cannot submit more than 16 names'
    }
  },
  owner2Names: {
    type: [NameSchema],
    validate: {
      validator: function(names) {
        return names.length <= 16;
      },
      message: 'Owner 2 cannot submit more than 16 names'
    }
  },
  
  // Shared favorites list (names submitted by both owners)
  sharedNames: {
    type: [NameSchema],
    default: []
  },
  
  // Preview matchups (auto-calculated in draft mode, not saved permanently)
  previewMatchups: {
    type: [MatchupSchema],
    default: []
  },
  
  // Sequential matchups organized by tournament rounds
  matchups: {
    roundOf32: {
      type: [MatchupSchema],
      default: []
    },
    roundOf16: {
      type: [MatchupSchema],
      default: []
    },
    elite8: {
      type: [MatchupSchema],
      default: []
    },
    final4: {
      type: [MatchupSchema],
      default: []
    },
    championship: {
      type: [MatchupSchema],
      default: []
    }
  },
  
  // All votes cast in this bracket
  votes: {
    type: [VoteSchema],
    default: []
  },
  
  // Tournament winner
  championNameId: {
    type: String,
    default: null
  },
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Pre-save hook to update the updatedAt timestamp
BracketSchema.pre('save', function() {
  this.updatedAt = Date.now();
});

/**
 * Instance Methods
 */

// Get all names in the bracket (combined from all lists)
// Shared names appear in both owner lists AND shared list, so we deduplicate
// Get all names in the bracket interleaved by owner rank.
// Returns [H#1, W#1, H#2, W#2, ..., H#16, W#16] so that when fed into the
// seeding algorithm, Husband's #1 lands on seed 1 (left bracket half) and
// Wife's #1 lands on seed 2 (right bracket half) — guaranteeing they can
// only meet in the Finals, not in an early round.
BracketSchema.methods.getAllNames = function() {
  const seenIds = new Set();
  const interleaved = [];

  const maxLen = Math.max(this.owner1Names.length, this.owner2Names.length);

  for (let i = 0; i < maxLen; i++) {
    // Husband's name at rank i+1
    if (i < this.owner1Names.length) {
      const name = this.owner1Names[i];
      if (!seenIds.has(name.id)) {
        seenIds.add(name.id);
        interleaved.push(name);
      }
    }
    // Wife's name at rank i+1
    if (i < this.owner2Names.length) {
      const name = this.owner2Names[i];
      if (!seenIds.has(name.id)) {
        seenIds.add(name.id);
        interleaved.push(name);
      }
    }
  }

  // Append any shared names not already captured above (edge-case guard)
  this.sharedNames.forEach(name => {
    if (!seenIds.has(name.id)) {
      seenIds.add(name.id);
      interleaved.push(name);
    }
  });

  return interleaved;
};

// Get total name count (counting each unique name only once)
// Shared names appear in owner lists (marked isShared: true) AND in sharedNames list
// We count: non-shared names from both owners + shared names
BracketSchema.methods.getTotalNameCount = function() {
  const nonSharedOwner1 = this.owner1Names.filter(n => !n.isShared).length;
  const nonSharedOwner2 = this.owner2Names.filter(n => !n.isShared).length;
  return nonSharedOwner1 + nonSharedOwner2 + this.sharedNames.length;
};

// Check if bracket is full (32 names total)
BracketSchema.methods.isFull = function() {
  return this.getTotalNameCount() === 32;
};

// Get matchups for a specific round
BracketSchema.methods.getMatchupsByRound = function(round) {
  const roundMap = {
    'Round of 32': this.matchups.roundOf32,
    'Round of 16': this.matchups.roundOf16,
    'Elite 8': this.matchups.elite8,
    'Final 4': this.matchups.final4,
    'Championship': this.matchups.championship
  };
  return roundMap[round] || [];
};

// Find a name by its ID across all lists
BracketSchema.methods.findNameById = function(nameId) {
  const allNames = this.getAllNames();
  return allNames.find(name => name.id === nameId);
};

/**
 * Static Methods
 */

// Find active brackets
BracketSchema.statics.findActive = function() {
  return this.find({ status: 'active' });
};

// Find brackets by status
BracketSchema.statics.findByStatus = function(status) {
  return this.find({ status });
};

// Create indexes for performance
BracketSchema.index({ status: 1, createdAt: -1 });
BracketSchema.index({ 'owner1Names.id': 1 });
BracketSchema.index({ 'owner2Names.id': 1 });
BracketSchema.index({ 'sharedNames.id': 1 });
BracketSchema.index({ 'votes.voterId': 1 });

const Bracket = mongoose.model('Bracket', BracketSchema);

module.exports = Bracket;
