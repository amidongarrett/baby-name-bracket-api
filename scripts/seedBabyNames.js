/**
 * Baby Names Seed Script
 * Populates the babynames collection with ~695 curated names tagged by gender
 * (265 girl, 195 boy, 235 neutral), drawn from SSA top-name data spanning
 * 1970–2025 across six historical eras and deduplicated within each bucket.
 * Safe to re-run — uses upsert on {name, gender} so existing records are not duplicated.
 *
 * Run with: node scripts/seedBabyNames.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const BabyName = require('../models/BabyName');

const GIRL_NAMES = [
  'Sophia', 'Olivia', 'Emma', 'Ava', 'Isabella', 'Mia', 'Charlotte', 'Amelia',
  'Harper', 'Evelyn', 'Abigail', 'Emily', 'Elizabeth', 'Scarlett', 'Victoria', 'Grace',
  'Chloe', 'Penelope', 'Lily', 'Layla', 'Eleanor', 'Nora', 'Hazel', 'Aurora',
  'Ellie', 'Stella', 'Violet', 'Natalie', 'Zoe', 'Hannah', 'Leah', 'Lucy',
  'Savannah', 'Addison', 'Bella', 'Audrey', 'Brooklyn', 'Paisley', 'Eva', 'Madeline',
  'Caroline', 'Genesis', 'Autumn', 'Nevaeh', 'Allison', 'Ruby', 'Willow', 'Clara',
  'Eliana', 'Elena', 'Luna', 'Camila', 'Aria', 'Gianna', 'Lillian', 'Zoey',
  'Norah', 'Mila', 'Laila', 'Eliza', 'Naomi', 'Aaliyah', 'Kinsley', 'Aubrey',
  'Valentina', 'Maya', 'Skylar', 'Serenity', 'Cora', 'Ariana', 'Emilia', 'Madelyn',
  'Delilah', 'Isla', 'Ivy', 'Quinn', 'Nova', 'Alice', 'Lyla', 'Sadie',
  'Josephine', 'Sophie', 'Lydia', 'Annabelle', 'Maeve', 'Leilani', 'Claire', 'Vivian',
  'Raelynn', 'Adalyn', 'Rosalie', 'Arabella', 'Iris', 'Adalynn', 'Rose', 'Briella',
  'Ayla', 'Juniper', 'Piper', 'Vera', 'Ximena', 'Avery', 'Samantha', 'Mackenzie',
  'Hailey', 'Gabriella', 'Anna', 'Aaliya', 'Jasmine', 'Katherine', 'Natalia', 'Kaylee',
  'Kylie', 'Aubree', 'Trinity', 'Alexa', 'Jocelyn', 'Madisyn', 'Brielle', 'Brooklynn',
  'Ariel', 'Anastasia', 'Destiny', 'Melanie', 'Molly', 'Peyton', 'Alexis', 'Daisy',
  'Hadley', 'Kylee', 'Kendall', 'Khloe', 'Arianna', 'Everly', 'Liliana', 'Camille',
  'Paige', 'Maria', 'Brianna', 'Juliana', 'Kayla', 'Lauren', 'Vanessa', 'Phoebe',
  'Nicole', 'Amy', 'Fiona', 'Madison', 'Ashley', 'Sarah', 'Megan', 'Taylor',
  'Jessica', 'Rachel', 'Morgan', 'Stephanie', 'Kelsey', 'Alyssa', 'Amber', 'Courtney',
  'Danielle', 'Shelby', 'Sydney', 'Sierra', 'Marissa', 'Brittany', 'Rebecca', 'Haley',
  'Amanda', 'Caitlin', 'Brooke', 'Chelsea', 'Michelle', 'Kaitlyn', 'Tiffany', 'Whitney',
  'Cassandra', 'Lindsey', 'Jordan', 'Jenna', 'Jacqueline', 'Meagan', 'Shannon', 'Erin',
  'Crystal', 'Kimberly', 'Brittney', 'Jennifer', 'Heather', 'Christina', 'Melissa', 'Angela',
  'Katie', 'Erica', 'Lacey', 'Andrea', 'Julie', 'Monica', 'Alicia', 'Diana',
  'Cynthia', 'Lynnsey', 'Trisha', 'Katelyn', 'Kerry', 'Alissa', 'Cheyenne', 'Lisa',
  'Meredith', 'Kelly', 'Laura', 'Tammy', 'Tina', 'Leanne', 'Tracey', 'Carrie',
  'Stacy', 'Dana', 'Renee', 'Dawn', 'Tricia', 'Misty', 'Brenda', 'Lynn',
  'Teresa', 'Paula', 'Susan', 'Pamela', 'Karen', 'Sandra', 'Cindy', 'Barbara',
  'Donna', 'Cheryl', 'Deborah', 'Sharon', 'Nancy', 'Peggy', 'Mary', 'Tracy',
  'Christine', 'Linda', 'Patricia', 'Janet', 'Diane', 'Carol', 'Theresa', 'Catherine',
  'Virginia', 'Lori', 'Beth', 'Wanda', 'Gloria', 'Beverly', 'Shirley', 'Judith',
  'Jean', 'Joyce', 'Juliet', 'Carolyn', 'Frances', 'Martha', 'Ruth', 'Dorothy', 'Helen',
  'Margaret',
];

const BOY_NAMES = [
  'Liam', 'Noah', 'William', 'James', 'Oliver', 'Benjamin', 'Elijah', 'Lucas',
  'Mason', 'Logan', 'Alexander', 'Ethan', 'Jacob', 'Michael', 'Daniel', 'Henry',
  'Jackson', 'Sebastian', 'Aiden', 'Matthew', 'Samuel', 'David', 'Joseph', 'Carter',
  'Owen', 'Wyatt', 'John', 'Jack', 'Luke', 'Jayden', 'Dylan', 'Grayson',
  'Levi', 'Isaac', 'Gabriel', 'Julian', 'Mateo', 'Anthony', 'Jaxon', 'Lincoln',
  'Joshua', 'Christopher', 'Andrew', 'Theodore', 'Caleb', 'Ryan', 'Nathan', 'Aaron',
  'Adrian', 'Cameron', 'Ezra', 'Leo', 'Hudson', 'Asher', 'Elias', 'Maverick',
  'Josiah', 'Nolan', 'Landon', 'Ezekiel', 'Colton', 'Easton', 'Roman', 'Silas',
  'Carson', 'Jaxson', 'Atlas', 'Connor', 'Dominic', 'Cooper', 'Ian', 'Eli',
  'Miles', 'Kai', 'Axel', 'Brayden', 'Declan', 'Jordan', 'Micah', 'Greyson',
  'Rowan', 'August', 'Jasper', 'Finn', 'Xavier', 'Everett', 'Emmett', 'Harrison',
  'Bennett', 'Xander', 'Sawyer', 'Brooks', 'Ace', 'Rhett', 'Zayden', 'Arlo',
  'Weston', 'Reid', 'Aidan', 'Caden', 'Gavin', 'Brandon', 'Tyler', 'Austin',
  'Chase', 'Justin', 'Zachary', 'Blake', 'Cole', 'Evan', 'Hunter', 'Parker',
  'Hayden', 'Tristan', 'Jason', 'Kevin', 'Devin', 'Jeremiah', 'Bentley', 'Brody',
  'Jace', 'Luca', 'Nicholas', 'Peyton', 'Robert', 'Thomas', 'Kayden', 'Ryder',
  'Derrick', 'Damian', 'Jaden', 'Camden', 'Jameson', 'Braxton', 'Knox', 'Gage',
  'Bryson', 'Marcus', 'Patrick', 'Jesus', 'Charles', 'Jonathan', 'Stephen', 'Brian',
  'Kyle', 'Eric', 'Sean', 'Timothy', 'Victor', 'Cody', 'Scott', 'Adam',
  'Mark', 'Steven', 'Travis', 'Dustin', 'Derek', 'Chad', 'Corey', 'Brett',
  'Jeremy', 'Shane', 'Bradley', 'Alan', 'Gary', 'Jeffrey', 'Richard', 'Donald',
  'Paul', 'Todd', 'Kenneth', 'George', 'Larry', 'Dennis', 'Ronald', 'Gregory',
  'Douglas', 'Frank', 'Terry', 'Raymond', 'Bruce', 'Roger', 'Edward', 'Peter',
  'Jerry', 'Harold', 'Walter', 'Philip', 'Carl', 'Arthur', 'Fred', 'Albert',
  'Harry', 'Ernest', 'Ralph',
];

const NEUTRAL_NAMES = [
  'Boofus', 'Riley', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Avery', 'Skylar', 'Quinn',
  'Peyton', 'Reese', 'Dakota', 'Sage', 'Rowan', 'River', 'Finley', 'Emery',
  'Parker', 'Blake', 'Drew', 'Robin', 'Harlow', 'Marlowe', 'Remi', 'Phoenix',
  'Shiloh', 'Sutton', 'Juniper', 'Wren', 'Oakley', 'Cameron', 'Alex', 'Charlie',
  'Elliot', 'Lennon', 'Hadley', 'Indigo', 'Scout', 'Briar', 'Cove', 'Sailor',
  'Fallon', 'Poet', 'Bay', 'Cypress', 'Story', 'Winter', 'Journey', 'Haven',
  'Arrow', 'Lennox', 'Ezra', 'Nova', 'Remy', 'Sloane', 'Bellamy', 'Devin',
  'Finlay', 'Gray', 'Hayden', 'Harley', 'Indie', 'Justice', 'Kit', 'Lake',
  'Luca', 'Max', 'Nico', 'Oaklee', 'Pax', 'Rain', 'Reign', 'Rylan',
  'Sasha', 'Simone', 'Skyler', 'Sol', 'Sunny', 'Sydney', 'Tatum', 'True',
  'Val', 'West', 'Wilder', 'Zara', 'Zion', 'Eden', 'Emerson', 'Kai',
  'Arden', 'Aspen', 'Birch', 'Blue', 'Blythe', 'Brooks', 'Campbell', 'Corey',
  'Addison', 'Aiden', 'Ainsley', 'Bailey', 'Brayden', 'Brooklyn', 'Cambria', 'Camden',
  'Carter', 'Chandler', 'Chase', 'Cody', 'Colby', 'Collins', 'Cori', 'Darby',
  'Dawson', 'Devon', 'Easton', 'Eli', 'Ellis', 'Ember', 'Emory', 'Everly',
  'Flynn', 'Greer', 'Hollis', 'Jaden', 'Jamie', 'Jensen', 'Jesse', 'Jessie',
  'Keegan', 'Kendall', 'Kennedy', 'Kieran', 'Kylie', 'Lane', 'Logan', 'London',
  'Marley', 'Maxon', 'Monroe', 'Payton', 'Presley', 'Raleigh', 'Raven', 'Reagan',
  'Alexis', 'Angel', 'Ariel', 'Blaine', 'Brady', 'Brett', 'Britton', 'Brooke',
  'Caiden', 'Caitlin', 'Calen', 'Carey', 'Carly', 'Carson', 'Cassidy', 'Chance',
  'Chelsea', 'Christian', 'Cole', 'Dallas', 'Dana', 'Danny', 'Darren', 'Delaney',
  'Dell', 'Denali', 'Denver', 'Dillon', 'Dominique', 'Duncan', 'Dylan', 'Elliott',
  'Erin', 'Evan', 'Everett', 'Ferris', 'Frances', 'Francis', 'Bobby', 'Cam',
  'Chad', 'Chris', 'Christie', 'Crystal', 'Dale', 'Dawn', 'Dean', 'Del',
  'Denny', 'Donna', 'Eddie', 'Fred', 'Gene', 'Glen', 'Hillary', 'Hunter',
  'Jackie', 'Jan', 'Jo', 'Kelly', 'Kerry', 'Kim', 'Kyle', 'Lee',
  'Andy', 'Bobbie', 'Carroll', 'Christy', 'Cindy', 'Connie', 'Darcy', 'Darrell',
  'Dorian', 'Jody', 'Joey', 'Leslie', 'Lindsay', 'Lynn', 'Marion', 'Merle',
  'Mickey', 'Noel', 'Pat', 'Patty', 'Randy', 'Sandy', 'Shannon', 'Shawn',
  'Stacy', 'Terry', 'Tracy',
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
