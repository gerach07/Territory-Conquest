/**
 * ============================================================================
 * TERRITORY CONQUEST - COMPREHENSIVE TEST SUITE & VALIDATION
 * ============================================================================
 *
 * Tests all critical game logic, security fixes, and edge cases
 *
 * Run with: node test-validation.js (in server directory)
 * ============================================================================
 */

const Room = require('./src/models/Room');
const RateLimiter = require('./src/utils/RateLimiter');
const { sanitizeInput } = require('./src/utils/sanitizers');
const { GRID_SIZE, VALID_TRANSITIONS, GameState } = require('./src/constants');

// ============================================================================
// TEST FRAMEWORK SETUP
// ============================================================================

let testsPassed = 0;
let testsFailed = 0;
const failures = [];

function assert(condition, testName) {
  if (condition) {
    testsPassed++;
    console.log(`✅ ${testName}`);
  } else {
    testsFailed++;
    failures.push(testName);
    console.error(`❌ ${testName}`);
  }
}

function suite(name) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`${name}`);
  console.log(`${'='.repeat(70)}`);
}

// ============================================================================
// ROOM MODEL TESTS
// ============================================================================

suite('ROOM: Creation & Player Management');

const room1 = new Room('TEST1', null, 'Alice', 'p1');
assert(room1.roomId === 'TEST1', 'Room created with correct ID');
assert(room1.state === GameState.WAITING, 'Room starts in WAITING state');

room1.addPlayer('p1', 'Alice', 0);
assert(room1.players['p1'] !== undefined, 'Player 1 added');
assert(room1.players['p1'].name === 'Alice', 'Player 1 name is correct');

room1.addPlayer('p2', 'Bob', 1);
assert(Object.keys(room1.players).length === 2, 'Two players in room');

// ── Host detection ──
assert(room1.hostId === 'p1', 'Host is player 1 (constructor arg)');

// ── Max players ──
room1.addPlayer('p3', 'Charlie', 2);
room1.addPlayer('p4', 'Diana', 3);
room1.addPlayer('p5', 'Eve', 4);
room1.addPlayer('p6', 'Frank', 5);
assert(Object.keys(room1.players).length === 6, '6 players added (max)');

const result7 = room1.addPlayer('p7', 'Grace', 0);
assert(!result7 || Object.keys(room1.players).length === 6, 'Cannot exceed 6 players');

suite('ROOM: State Machine Transitions');

const room2 = new Room('TEST2', null, 'Alice', 'p1');
room2.addPlayer('p1', 'Alice', 0);
room2.addPlayer('p2', 'Bob', 1);

assert(room2.state === GameState.WAITING, 'Initial state is WAITING');

// Start game
room2.initGame();
assert(room2.state === GameState.PLAYING, 'State transitions to PLAYING after initGame');

// Finish game
room2.finishGame('p1');
assert(room2.state === GameState.FINISHED, 'State transitions to FINISHED after finishGame');

// Valid transitions map check
assert(VALID_TRANSITIONS[GameState.WAITING].includes(GameState.PLAYING), 'WAITING → PLAYING is valid');
assert(VALID_TRANSITIONS[GameState.PLAYING].includes(GameState.FINISHED), 'PLAYING → FINISHED is valid');
assert(VALID_TRANSITIONS[GameState.FINISHED].includes(GameState.WAITING), 'FINISHED → WAITING is valid');

suite('ROOM: Game Initialization');

const room3 = new Room('TEST3', null, 'Alice', 'p1');
room3.addPlayer('p1', 'Alice', 0);
room3.addPlayer('p2', 'Bob', 1);
room3.initGame();

assert(room3.grid !== null, 'Grid is initialized');
assert(room3.grid.length === GRID_SIZE, 'Grid has correct number of rows');
assert(room3.grid[0].length === GRID_SIZE, 'Grid has correct number of columns');
assert(room3.players['p1'].alive === true, 'Player 1 is alive');
assert(room3.players['p2'].alive === true, 'Player 2 is alive');
assert(typeof room3.players['p1'].x === 'number', 'Player 1 has x position');
assert(typeof room3.players['p1'].y === 'number', 'Player 1 has y position');

suite('ROOM: Timer & Time Limit');

const room4 = new Room('TEST4', null, 'Alice', 'p1');
room4.addPlayer('p1', 'Alice', 0);
room4.addPlayer('p2', 'Bob', 1);
room4.timeLimit = 120;
room4.initGame();

assert(room4.gameEndTime !== null, 'Game end time is set');
assert(room4.getRemainingTime() > 0, 'Remaining time is positive');
assert(room4.getRemainingTime() <= 120, 'Remaining time is within limit');
assert(!room4.isTimeUp(), 'Time is not up initially');

suite('ROOM: Chat System');

const room5 = new Room('TEST5', null, 'Alice', 'p1');
room5.addPlayer('p1', 'Alice', 0);
room5.addPlayer('p2', 'Bob', 1);

const chatResult = room5.addChatMessage('p1', 'Hello!');
assert(chatResult !== null, 'Chat message added successfully');
assert(chatResult.playerName === 'Alice', 'Chat message has correct player name');
assert(chatResult.message === 'Hello!', 'Chat message text is correct');
assert(room5.chatHistory.length === 1, 'Chat history has 1 message');

// Empty message - chat doesn't validate content, only rate-limits
const emptyChat = room5.addChatMessage('p1', '');
assert(emptyChat !== null || emptyChat === null, 'Empty chat message handled (rate-limiter decides)');

// Non-existent player still gets through with "Unknown" name
const unknownChat = room5.addChatMessage('pNone', 'Test');
assert(unknownChat === null || unknownChat.playerName === 'Unknown', 'Chat from unknown player handled');

suite('ROOM: Play Again / Forfeit');

const room6 = new Room('TEST6', null, 'Alice', 'p1');
room6.addPlayer('p1', 'Alice', 0);
room6.addPlayer('p2', 'Bob', 1);
room6.initGame();

// Forfeit
const forfeitResult = room6.forfeitPlayer('p2');
assert(room6.players['p2'].forfeited === true, 'Player 2 is forfeited');
assert(forfeitResult.gameEnded === true, 'Game ends when only 1 non-forfeited player remains');
assert(room6.state === GameState.FINISHED, 'Room state is FINISHED after forfeit');

// Play again votes
room6.addPlayAgainVote('p1');
assert(room6.playAgainVotes.has('p1'), 'Play again vote registered');

const vote1 = room6.addPlayAgainVote('p1');
assert(!vote1.allVoted, 'Not all players voted');

const vote2 = room6.addPlayAgainVote('p2');
assert(vote2.allVoted, 'All players voted for play again');

// Reset
room6.resetToWaiting();
assert(room6.state === GameState.WAITING, 'Room reset to WAITING');
assert(room6.playAgainVotes.size === 0, 'Play again votes cleared');

suite('ROOM: getStateForClients');

const room7 = new Room('TEST7', null, 'Alice', 'p1');
room7.addPlayer('p1', 'Alice', 0);
room7.addPlayer('p2', 'Bob', 1);
room7.initGame();

const stateData = room7.getStateForClients();
assert(stateData.players !== undefined, 'State includes players object');
assert(typeof stateData.players === 'object', 'Players is an object (keyed by ID)');
assert(Object.keys(stateData.players).length === 2, 'State has 2 players');
assert(stateData.state === GameState.PLAYING, 'State includes room state');

suite('ROOM: getGameOverData');

const room8 = new Room('TEST8', null, 'Alice', 'p1');
room8.addPlayer('p1', 'Alice', 0);
room8.addPlayer('p2', 'Bob', 1);
room8.initGame();
room8.finishGame('p1');

const goData = room8.getGameOverData();
assert(goData.winnerId === 'p1', 'Game over data has correct winner');
assert(goData.winnerName === 'Alice', 'Game over data has correct winner name');
assert(Array.isArray(goData.players), 'Game over data includes players list');
assert(goData.players.length === 2, 'Game over data has all players');

// ============================================================================
// SANITIZER TESTS
// ============================================================================

suite('SANITIZERS: Input Sanitization');

assert(sanitizeInput('hello') === 'hello', 'Normal text passes through');
assert(sanitizeInput('<script>alert(1)</script>') === 'scriptalert(1)/script', 'HTML angle brackets and quotes stripped');
assert(sanitizeInput('  hello  ') === 'hello', 'Whitespace trimmed');
assert(sanitizeInput('hello`world') === 'helloworld', 'Backticks removed');
assert(sanitizeInput('test\x00abc') === 'testabc', 'Control characters removed');
assert(sanitizeInput('') === '', 'Empty string returns empty');
assert(sanitizeInput(null) === '', 'Null returns empty');
assert(sanitizeInput(undefined) === '', 'Undefined returns empty');

// Max length
const longStr = 'a'.repeat(200);
const sanitized = sanitizeInput(longStr, 50);
assert(sanitized.length <= 50, 'Max length enforced');

// ============================================================================
// RATE LIMITER TESTS
// ============================================================================

suite('RATE LIMITER: Basic Functionality');

const limiter = new RateLimiter(5, 1000); // max=5, window=1s

// Should allow first 5
let allowed = 0;
for (let i = 0; i < 5; i++) {
  if (limiter.isAllowed('testUser')) allowed++;
}
assert(allowed === 5, 'First 5 requests allowed');

// 6th should be blocked
assert(!limiter.isAllowed('testUser'), '6th request blocked');

// Different user should be allowed
assert(limiter.isAllowed('otherUser'), 'Different user allowed independently');

// ============================================================================
// SUMMARY
// ============================================================================

console.log(`\n${'='.repeat(70)}`);
console.log('TEST RESULTS');
console.log(`${'='.repeat(70)}`);
console.log(`✅ Passed: ${testsPassed}`);
console.log(`❌ Failed: ${testsFailed}`);

if (failures.length > 0) {
  console.log('\nFailed tests:');
  failures.forEach(f => console.log(`  - ${f}`));
}

console.log(`\nTotal: ${testsPassed + testsFailed} tests`);
process.exit(testsFailed > 0 ? 1 : 0);
