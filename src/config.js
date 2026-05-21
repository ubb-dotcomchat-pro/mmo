const PORT = Number.parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '127.0.0.1';
const VISIBILITY_RADIUS = 8;
const MAX_CHAT_MESSAGES = 20;
const MAX_CHARACTERS_PER_ACCOUNT = 3;
const MAX_NAME_LENGTH = 16;
const MOVE_VECTORS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

module.exports = {
  HOST,
  MAX_CHARACTERS_PER_ACCOUNT,
  MAX_CHAT_MESSAGES,
  MAX_NAME_LENGTH,
  MOVE_VECTORS,
  PORT,
  VISIBILITY_RADIUS,
};
