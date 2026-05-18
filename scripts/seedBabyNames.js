/**
 * Baby Names Seed Script
 * Populates the babynames collection with ~150 curated names tagged by gender.
 * Safe to re-run — uses upsert on {name, gender} so existing records are not duplicated.
 *
 * Run with: node scripts/seedBabyNames.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const BabyName = require('../models/BabyName');

const GIRL_NAMES = [
  'Sophia', 'Olivia', 'Emma', 'Ava', 'Isabella', 'Mia', 'Charlotte', 'Amelia',
  'Harper', 'Evelyn', 'Abigail', 'Emily', 'Elizabeth', 'Scarlett', 'Victoria',
  'Grace', 'Chloe', 'Penelope', 'Lily', 'Layla', 'Eleanor', 'Nora', 'Hazel',
  'Aurora', 'Ellie', 'Stella', 'Violet', 'Natalie', 'Zoe', 'Hannah', 'Leah',
  'Lucy', 'Savannah', 'Addison', 'Bella', 'Audrey', 'Brooklyn', 'Paisley', 'Eva',
  'Madeline', 'Caroline', 'Genesis', 'Autumn', 'Nevaeh', 'Allison', 'Ruby',
  'Willow', 'Clara', 'Eliana', 'Elena'
];

const BOY_NAMES = [
  'Liam', 'Noah', 'William', 'James', 'Oliver', 'Benjamin', 'Elijah', 'Lucas',
  'Mason', 'Logan', 'Alexander', 'Ethan', 'Jacob', 'Michael', 'Daniel', 'Henry',
  'Jackson', 'Sebastian', 'Aiden', 'Matthew', 'Samuel', 'David', 'Joseph',
  'Carter', 'Owen', 'Wyatt', 'John', 'Jack', 'Luke', 'Jayden', 'Dylan',
  'Grayson', 'Levi', 'Isaac', 'Gabriel', 'Julian', 'Mateo', 'Anthony', 'Jaxon',
  'Lincoln', 'Joshua', 'Christopher', 'Andrew', 'Theodore', 'Caleb', 'Ryan',
  'Nathan', 'Aaron', 'Adrian', 'Cameron'
];

const NEUTRAL_NAMES = [
  'Riley', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Avery', 'Skylar', 'Quinn',
  'Peyton', 'Reese', 'Dakota', 'Sage', 'Rowan', 'River', 'Finley', 'Emery',
  'Parker', 'Blake', 'Drew', 'Robin', 'Harlow', 'Marlowe', 'Remi', 'Phoenix',
  'Shiloh', 'Sutton', 'Juniper', 'Wren', 'Oakley', 'Cameron', 'Alex', 'Charlie',
  'Elliot', 'Lennon', 'Hadley', 'Indigo', 'Scout', 'Briar', 'Cove', 'Sailor',
  'Fallon', 'Poet', 'Bay', 'Cypress', 'Story', 'Winter', 'Journey', 'Haven',
  'Arrow', 'Lennox'
];

function buildOps(names, gender) {
  return names.map(name => ({
    updateOne: {
      filter: { name, gender },
      update: { $setOnInsert: { name, gender } },
      upsert: true
    }
  }));
}

async function seedBabyNames() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/babynames');
    console.log('Connected to MongoDB');

    const ops = [
      ...buildOps(GIRL_NAMES, 'girl'),
      ...buildOps(BOY_NAMES, 'boy'),
      ...buildOps(NEUTRAL_NAMES, 'neutral')
    ];

    console.log(`Upserting ${ops.length} baby name records...`);
    const result = await BabyName.bulkWrite(ops);
    console.log(`Upserted: ${result.upsertedCount} new, matched: ${result.matchedCount} existing`);
    console.log('Baby names seed complete!');

    await mongoose.connection.close();
    console.log('Database connection closed');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding baby names:', error);
    process.exit(1);
  }
}

seedBabyNames();
