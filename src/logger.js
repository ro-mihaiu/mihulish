const fs = require("node:fs");
const path = require("node:path");

const LOGS_DIR = path.resolve(process.env.LOGS_DIR || "./logs");
const MAX_LINES = 1000;

let currentDate = null;
let lineCount = 0;

function dateStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function timeStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

fs.mkdirSync(LOGS_DIR, { recursive: true });

function rotate(force = false) {
  const today = dateStamp();
  if (force || currentDate !== today || lineCount >= MAX_LINES) {
    currentDate = today;
    lineCount = 0;
    // start a fresh latest.log alongside the new dated file
    try {
      fs.writeFileSync(path.join(LOGS_DIR, "latest.log"), "");
    } catch {
      // ignore write errors
    }
  }
}

function write(line) {
  rotate();
  lineCount += 1;
  try {
    fs.appendFileSync(path.join(LOGS_DIR, `latest.log`), line + "\n");
    fs.appendFileSync(path.join(LOGS_DIR, `${currentDate}.log`), line + "\n");
  } catch {
    // logging must never crash the bot
  }
}

function log(message) {
  const line = `[${dateStamp()} ${timeStamp()}] ${message}`;
  console.log(line);
  write(line);
}

function error(message, err = null) {
  const detail = err ? ` — ${err.message ?? err}` : "";
  const line = `[${dateStamp()} ${timeStamp()}] ${message}${detail}`;
  console.error(line);
  if (err?.stack) write(`[${dateStamp()} ${timeStamp()}] ${err.stack}`);
  write(line);
}

module.exports = { log, error, LOGS_DIR };
